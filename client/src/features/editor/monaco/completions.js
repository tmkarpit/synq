// Suggestions while typing, on top of the language services (setupMonaco.js):
//   JavaScript / TypeScript / HTML / CSS: VS Code's own services (members, DOM, tags,
//     CSS properties) plus the snippets below.
//   Python / C / C++ / Java (no service in Monaco): keywords, common built-ins and
//     snippets, so typing "pri" offers print(), "main" a whole main function, and so on.
// Snippets use Monaco's syntax: $1, ${1:name} are stops (Tab jumps), $0 is the end.

const S = (label, body, detail) => ({ label, body, detail });

const JS_SNIPPETS = [
  S('log', 'console.log($1);$0', 'console.log()'),
  S('for', 'for (let ${1:i} = 0; ${1:i} < ${2:array}.length; ${1:i}++) {\n\t$0\n}', 'for loop'),
  S('forof', 'for (const ${1:item} of ${2:items}) {\n\t$0\n}', 'for...of loop'),
  S('forin', 'for (const ${1:key} in ${2:object}) {\n\t$0\n}', 'for...in loop'),
  S('foreach', '${1:array}.forEach((${2:item}) => {\n\t$0\n});', 'forEach'),
  S('fn', 'function ${1:name}(${2:params}) {\n\t$0\n}', 'function'),
  S('afn', 'const ${1:name} = (${2:params}) => {\n\t$0\n};', 'arrow function'),
  S('asyncfn', 'async function ${1:name}(${2:params}) {\n\t$0\n}', 'async function'),
  S('if', 'if (${1:condition}) {\n\t$0\n}', 'if'),
  S('ife', 'if (${1:condition}) {\n\t$2\n} else {\n\t$0\n}', 'if / else'),
  S('try', 'try {\n\t$1\n} catch (${2:error}) {\n\t$0\n}', 'try / catch'),
  S('class', 'class ${1:Name} {\n\tconstructor(${2:params}) {\n\t\t$0\n\t}\n}', 'class'),
  S('imp', "import ${2:name} from '${1:module}';$0", 'import'),
  S('timeout', 'setTimeout(() => {\n\t$0\n}, ${1:1000});', 'setTimeout'),
  S(
    'fetch',
    "const res = await fetch('${1:url}');\nconst ${2:data} = await res.json();$0",
    'fetch JSON',
  ),
  S('qs', "document.querySelector('${1:selector}')$0", 'document.querySelector'),
  S(
    'ael',
    "${1:element}.addEventListener('${2:click}', (${3:event}) => {\n\t$0\n});",
    'addEventListener',
  ),
];
const REACT_SNIPPETS = [
  S('useState', 'const [${1:value}, set${2:Value}] = useState(${3:initial});$0', 'React useState'),
  S('useEffect', 'useEffect(() => {\n\t$1\n}, [${2}]);$0', 'React useEffect'),
  S(
    'rfc',
    'export default function ${1:Component}() {\n\treturn (\n\t\t<div>$0</div>\n\t);\n}',
    'React component',
  ),
];
const JS_KEYWORDS =
  'const let var function return if else for while do class extends import export default from async await new this try catch finally throw switch case break continue typeof instanceof null undefined true false of in yield'.split(
    ' ',
  );

const LANGS = {
  python: {
    keywords:
      'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'.split(
        ' ',
      ),
    functions:
      'print input len range int str float bool list dict set tuple open enumerate zip sorted sum min max abs round isinstance type map filter any all reversed'.split(
        ' ',
      ),
    snippets: [
      S('def', 'def ${1:name}(${2:params}):\n\t${0:pass}', 'function'),
      S('class', 'class ${1:Name}:\n\tdef __init__(self${2:, params}):\n\t\t${0:pass}', 'class'),
      S('if', 'if ${1:condition}:\n\t${0:pass}', 'if'),
      S('ife', 'if ${1:condition}:\n\t${2:pass}\nelse:\n\t${0:pass}', 'if / else'),
      S('for', 'for ${1:item} in ${2:items}:\n\t${0:pass}', 'for loop'),
      S('forr', 'for ${1:i} in range(${2:10}):\n\t${0:pass}', 'for i in range()'),
      S('while', 'while ${1:condition}:\n\t${0:pass}', 'while loop'),
      S(
        'try',
        'try:\n\t${1:pass}\nexcept ${2:Exception} as ${3:e}:\n\t${0:print(e)}',
        'try / except',
      ),
      S('with', "with open('${1:file.txt}') as ${2:f}:\n\t${0:data = f.read()}", 'with open()'),
      S('main', "def main():\n\t${0:pass}\n\n\nif __name__ == '__main__':\n\tmain()", 'main guard'),
      S('lc', '[${1:x} for ${1:x} in ${2:items}]$0', 'list comprehension'),
    ],
  },
  c: {
    keywords:
      'auto break case char const continue default do double else enum extern float for goto if int long register return short signed sizeof static struct switch typedef union unsigned void volatile while'.split(
        ' ',
      ),
    functions:
      'printf scanf malloc calloc free strlen strcpy strcmp strcat memset memcpy fgets puts getchar sqrt pow abs exit'.split(
        ' ',
      ),
    snippets: [
      S('main', '#include <stdio.h>\n\nint main(void) {\n\t$0\n\treturn 0;\n}', 'main function'),
      S('inc', '#include <${1:stdio.h}>$0', '#include'),
      S('printf', 'printf("${1:%d}\\n", ${2:value});$0', 'printf'),
      S('scanf', 'scanf("${1:%d}", &${2:value});$0', 'scanf'),
      S('for', 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t$0\n}', 'for loop'),
      S('while', 'while (${1:condition}) {\n\t$0\n}', 'while loop'),
      S('if', 'if (${1:condition}) {\n\t$0\n}', 'if'),
      S('ife', 'if (${1:condition}) {\n\t$2\n} else {\n\t$0\n}', 'if / else'),
      S('struct', 'struct ${1:Name} {\n\t${0:int value;}\n};', 'struct'),
    ],
  },
  cpp: {
    keywords:
      'auto bool break case catch char class const constexpr continue default delete do double else enum explicit false float for friend if inline int long namespace new nullptr operator private protected public return short signed sizeof static struct switch template this throw true try typedef typename union unsigned using virtual override void while std'.split(
        ' ',
      ),
    functions:
      'std::cout std::cin std::endl std::vector std::string std::map std::unordered_map std::set std::pair std::sort std::max std::min std::swap std::reverse std::find std::getline'.split(
        ' ',
      ),
    snippets: [
      S(
        'main',
        '#include <iostream>\nusing namespace std;\n\nint main() {\n\t$0\n\treturn 0;\n}',
        'main function',
      ),
      S('inc', '#include <${1:iostream}>$0', '#include'),
      S('cout', 'cout << ${1:value} << endl;$0', 'cout'),
      S('cin', 'cin >> ${1:value};$0', 'cin'),
      S('for', 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t$0\n}', 'for loop'),
      S('forr', 'for (auto &${1:x} : ${2:items}) {\n\t$0\n}', 'range-based for'),
      S('vec', 'vector<${1:int}> ${2:v};$0', 'vector'),
      S('class', 'class ${1:Name} {\npublic:\n\t${1:Name}() {}\n\t$0\n};', 'class'),
      S('if', 'if (${1:condition}) {\n\t$0\n}', 'if'),
      S('ife', 'if (${1:condition}) {\n\t$2\n} else {\n\t$0\n}', 'if / else'),
    ],
  },
  java: {
    keywords:
      'abstract boolean break byte case catch char class continue default do double else enum extends final finally float for if implements import instanceof int interface long new package private protected public return short static super switch this throw throws try void while true false null var String'.split(
        ' ',
      ),
    functions:
      'System.out.println System.out.print System.out.printf Math.max Math.min Math.abs Math.sqrt Math.pow Integer.parseInt String.valueOf Arrays.sort'.split(
        ' ',
      ),
    snippets: [
      S('main', 'public static void main(String[] args) {\n\t$0\n}', 'main method'),
      S('psvm', 'public static void main(String[] args) {\n\t$0\n}', 'main method'),
      S('sout', 'System.out.println($1);$0', 'System.out.println'),
      S('souf', 'System.out.printf("${1:%d}%n", ${2:value});$0', 'System.out.printf'),
      S(
        'scanner',
        'Scanner ${1:sc} = new Scanner(System.in);$0',
        'Scanner (needs import java.util.Scanner)',
      ),
      S('for', 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t$0\n}', 'for loop'),
      S('fore', 'for (${1:int} ${2:x} : ${3:items}) {\n\t$0\n}', 'for-each'),
      S('class', 'public class ${1:Name} {\n\t$0\n}', 'class'),
      S('if', 'if (${1:condition}) {\n\t$0\n}', 'if'),
      S('ife', 'if (${1:condition}) {\n\t$2\n} else {\n\t$0\n}', 'if / else'),
      S('try', 'try {\n\t$1\n} catch (${2:Exception} ${3:e}) {\n\t$0\n}', 'try / catch'),
    ],
  },
  // JavaScript and TypeScript have VS Code's language service; these add snippets.
  javascript: { snippets: JS_SNIPPETS },
  typescript: { snippets: JS_SNIPPETS },
  // .jsx / .tsx files keep their own highlighting, so they also get the keywords.
  jsx: { keywords: JS_KEYWORDS, snippets: [...JS_SNIPPETS, ...REACT_SNIPPETS] },
  tsx: { keywords: JS_KEYWORDS, snippets: [...JS_SNIPPETS, ...REACT_SNIPPETS] },
};

// Types and streams: inserted as they are, without "()".
const NOT_CALLED = new Set(
  'std::cout std::cin std::endl std::vector std::string std::map std::unordered_map std::set std::pair'.split(
    ' ',
  ),
);

const HTML_PAGE =
  '<!DOCTYPE html>\n<html lang="en">\n<head>\n\t<meta charset="UTF-8">\n\t<meta name="viewport" content="width=device-width, initial-scale=1.0">\n\t<title>${1:Document}</title>\n</head>\n<body>\n\t$0\n</body>\n</html>';

/** Registers the providers once (Monaco keeps them for every editor). */
export function registerCompletions(monaco) {
  const { CompletionItemKind: K, CompletionItemInsertTextRule: R } = monaco.languages;

  Object.entries(LANGS).forEach(([language, { keywords = [], functions = [], snippets = [] }]) => {
    monaco.languages.registerCompletionItemProvider(language, {
      provideCompletionItems(model, position) {
        const word = model.getWordUntilPosition(position);
        const range = new monaco.Range(
          position.lineNumber,
          word.startColumn,
          position.lineNumber,
          word.endColumn,
        );
        const before = model.getLineContent(position.lineNumber).slice(0, word.startColumn - 1);
        // "std::co" or "System.out.pr": insert only what is not typed yet.
        const rest = (name) => {
          const cuts = [...name.matchAll(/::|\./g)].map((m) => m.index + m[0].length);
          const typed = cuts.reverse().find((i) => before.endsWith(name.slice(0, i)));
          return typed ? name.slice(typed) : name;
        };
        return {
          suggestions: [
            ...snippets.map((s) => ({
              label: s.label,
              kind: K.Snippet,
              detail: s.detail,
              documentation: s.body.replace(/\$\{\d+:([^}]*)\}/g, '$1').replace(/\$\d/g, ''),
              insertText: s.body,
              insertTextRules: R.InsertAsSnippet,
              range,
              sortText: `0${s.label}`,
            })),
            ...functions.map((f) => ({
              label: f,
              kind: NOT_CALLED.has(f) ? K.Class : K.Function,
              filterText: rest(f),
              insertText: NOT_CALLED.has(f) ? rest(f) : `${rest(f)}($1)$0`,
              insertTextRules: R.InsertAsSnippet,
              range,
              sortText: `1${f}`,
            })),
            ...keywords.map((k) => ({
              label: k,
              kind: K.Keyword,
              insertText: k,
              range,
              sortText: `2${k}`,
            })),
          ],
        };
      },
    });
  });

  // VS Code's "!" in an HTML file: a whole HTML5 page.
  monaco.languages.registerCompletionItemProvider('html', {
    triggerCharacters: ['!'],
    provideCompletionItems(model, position) {
      const before = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
      if (!/^\s*!$/.test(before)) return { suggestions: [] };
      const start = before.lastIndexOf('!') + 1;
      return {
        suggestions: [
          {
            label: '!',
            kind: K.Snippet,
            detail: 'HTML5 page',
            documentation: 'A complete HTML5 document (like Emmet "!" in VS Code)',
            insertText: HTML_PAGE,
            insertTextRules: R.InsertAsSnippet,
            range: new monaco.Range(
              position.lineNumber,
              start,
              position.lineNumber,
              position.column,
            ),
            sortText: '0',
          },
        ],
      };
    },
  });
}
