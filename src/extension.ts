import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    vscode.window.showInformationMessage('C++ Unused Variable Detector STARTED!');
    
    // Создаём стиль оформления для неиспользуемых переменных
    const decorationType = vscode.window.createTextEditorDecorationType({
        backgroundColor: 'rgba(255,0,0,0.3)',
        border: '1px solid red',
        after: {
            contentText: ' ← UNUSED',
            color: 'red'
        }
    });

    /**
     * Главная функция поиска неиспользуемых переменных
     * @param text - весь текст документа
     * @returns массив диапазонов (Range) с позициями неиспользуемых переменных
     */
    function findUnusedVariables(text: string): vscode.Range[] {
        const lines = text.split('\n');
        
        // Карта объявленных переменных: имя -> {строка, позиция, тип}
        const declarations = new Map<string, {line: number, start: number, end: number, type: string}>();
        
        // Множество всех использованных переменных в коде
        const usages = new Set<string>();
        
        // Массив диапазонов неиспользуемых переменных для подсветки
        const unusedRanges: vscode.Range[] = [];

        // Список ключевых слов C++ которые нужно игнорировать
        const keywords = new Set([
            'int', 'float', 'double', 'char', 'bool', 'string', 'void', 
            'long', 'short', 'unsigned', 'signed', 'const', 'static',
            'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break',
            'continue', 'return', 'true', 'false', 'null', 'nullptr',
            'class', 'struct', 'public', 'private', 'protected',
            'namespace', 'using', 'include', 'define', 'auto',
            'main', 'cout', 'cin', 'endl', 'std', 'swap', 'array',
            'vector', 'map', 'set', 'list', 'queue', 'stack',
            'printf', 'scanf', 'iostream', 'string', 'algorithm',
            'size', 'push', 'pop', 'begin', 'end'
        ]);

        // ============================================================
        // ШАГ 1: Собираем все объявления переменных
        // ============================================================
        lines.forEach((line, lineIndex) => {
            const trimmedLine = line.trim();
            
            // Пропускаем комментарии и пустые строки
            if (trimmedLine.startsWith('//') || trimmedLine.startsWith('/*') || !trimmedLine) {
                return;
            }

            // ------------------------------------------------------------
            // 1.1: Обнаруживаем параметры функций
            // Пример: void func(int left, double right, string name)
            // ------------------------------------------------------------
            const funcParamRegex = /\b(int|float|double|char|bool|string|long|short|void|auto)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*(?=[,\)])/g;
            let paramMatch;
            while ((paramMatch = funcParamRegex.exec(line)) !== null) {
                const varName = paramMatch[2];
                const startIndex = paramMatch.index + paramMatch[1].length + 1;
                
                if (!declarations.has(varName) && !keywords.has(varName)) {
                    declarations.set(varName, { 
                        line: lineIndex, 
                        start: startIndex,
                        end: startIndex + varName.length,
                        type: 'param' 
                    });
                }
            }

            // ------------------------------------------------------------
            // 1.2: Обнаруживаем переменные в циклах for
            // Пример: for(int i = 0; ...) или for (int counter = 1; ...)
            // ------------------------------------------------------------
            if (trimmedLine.includes('for')) {
                const forVarRegex = /\b(int|float|double|char|bool|string|long|short|auto)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=/g;
                let forMatch;
                while ((forMatch = forVarRegex.exec(line)) !== null) {
                    const varName = forMatch[2];
                    const startIndex = forMatch.index + forMatch[1].length + 1;
                    
                    if (!declarations.has(varName) && !keywords.has(varName)) {
                        declarations.set(varName, { 
                            line: lineIndex, 
                            start: startIndex,
                            end: startIndex + varName.length,
                            type: 'for' 
                        });
                    }
                }
            }

            // ------------------------------------------------------------
            // 1.3: Обнаруживаем обычные объявления переменных
            // Пример: int variable = 5; или string longName;
            // ------------------------------------------------------------
            const varDeclRegex = /\b(int|float|double|char|bool|string|long|short|auto)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*(?=[;=,])/g;
            let declMatch;
            while ((declMatch = varDeclRegex.exec(line)) !== null) {
                const varName = declMatch[2];
                const startIndex = declMatch.index + declMatch[1].length + 1;
                
                // Проверяем что это не параметр функции
                const isInFunctionDeclaration = line.includes('(') && 
                                                line.indexOf('(') < declMatch.index && 
                                                line.indexOf(')') > declMatch.index;
                
                if (!declarations.has(varName) && !isInFunctionDeclaration && !keywords.has(varName)) {
                    declarations.set(varName, { 
                        line: lineIndex, 
                        start: startIndex,
                        end: startIndex + varName.length,
                        type: 'variable' 
                    });
                }
            }
        });

        // ============================================================
        // ШАГ 2: Собираем все использования переменных
        // ВАЖНО: исключаем саму строку объявления!
        // ============================================================
        lines.forEach((line, lineIndex) => {
            // Пропускаем служебные строки
            if (line.trim().startsWith('#') || 
                line.trim().startsWith('using') ||
                line.trim().startsWith('//')) {
                return;
            }

            // Удаляем комментарии из строки
            const lineWithoutComments = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');

            // Ищем все идентификаторы в строке
            const identifierRegex = /\b[a-zA-Z_][a-zA-Z0-9_]*\b/g;
            let match;
            
            while ((match = identifierRegex.exec(lineWithoutComments)) !== null) {
                const identifier = match[0];
                const position = match.index;
                
                // Пропускаем ключевые слова
                if (keywords.has(identifier)) {
                    continue;
                }
                
                // Проверяем: это объявление или использование?
                const declaration = declarations.get(identifier);
                
                if (declaration) {
                    // Если это та же строка И та же позиция - это объявление, пропускаем
                    if (declaration.line === lineIndex && 
                        position >= declaration.start && 
                        position < declaration.end) {
                        continue;
                    }
                    
                    // Иначе - это использование переменной!
                    usages.add(identifier);
                } else {
                    // Переменная не объявлена (может быть из другой области) - считаем использованием
                    usages.add(identifier);
                }
            }
        });

        // ============================================================
        // ШАГ 3: Находим неиспользуемые переменные
        // Проверяем только обычные переменные (не параметры, не for)
        // ============================================================
        declarations.forEach((pos, varName) => {
            // Подсвечиваем только обычные переменные которые нигде не используются
            if (pos.type === 'variable' && !usages.has(varName)) {
                const range = new vscode.Range(
                    new vscode.Position(pos.line, pos.start),
                    new vscode.Position(pos.line, pos.end)
                );
                unusedRanges.push(range);
            }
        });

        return unusedRanges;
    }

    /**
     * Обновляет подсветку неиспользуемых переменных в активном редакторе
     */
    function updateDecorations() {
        const editor = vscode.window.activeTextEditor;
        
        // Работаем только с C++ файлами
        if (!editor || editor.document.languageId !== 'cpp') {
            return;
        }

        // Получаем весь текст документа
        const text = editor.document.getText();
        
        // Находим неиспользуемые переменные
        const unusedRanges = findUnusedVariables(text);
        
        // Применяем подсветку
        editor.setDecorations(decorationType, unusedRanges);
    }

    // Подписываемся на события изменения документа и смены редактора
    vscode.workspace.onDidChangeTextDocument(updateDecorations);
    vscode.window.onDidChangeActiveTextEditor(updateDecorations);
    
    // Запускаем первичную проверку
    updateDecorations();
}

export function deactivate() {}