// Shared harness: loads the parseProblems/escape/etc. code out of index.html
// into a Node-friendly environment, and provides a Mammoth -> text pipeline
// that mirrors the browser's handleFileUpload behavior.
//
// Keeping this as a harness rather than importing directly from a module
// until Phase 2 of the refactor extracts the JS into its own file.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import mammoth from 'mammoth';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

// Extract the main <script> block from index.html and evaluate it against a
// minimal jsdom document so we can call parseProblems / generateOLX / etc.
export function loadConverterApi() {
    const html = readFileSync(resolve(repoRoot, 'index.html'), 'utf8');
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    const parserScript = scripts[1]; // [0] is the MathJax config

    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    // Install the globals the parser relies on. Anything touching the real
    // DOM (renderPreview, etc.) is a no-op here; we only exercise pure logic.
    globalThis.document = dom.window.document;
    globalThis.window = dom.window;
    globalThis.Node = dom.window.Node;
    globalThis.DOMParser = dom.window.DOMParser;

    const expose = [
        'parseProblems',
        'generateOLX',
        'escapeXml',
        'escapeXmlWithFormatting',
        'escapeHtmlWithFormatting',
        'sanitizeHtml',
        'preNormalizeEmphasis',
        'normalizeLatexChoices',
        'normalizeCorrectLetters',
        'makeSafeFilename',
        'isProblemMultipleChoice',
        'getMaxAttempts',
        'generateUUID'
    ];
    const wrapper =
        '(function(){\n' + parserScript + '\n; return { ' +
        expose.map(n => `${n}: typeof ${n} === "function" || typeof ${n} === "object" ? ${n} : undefined`).join(', ') +
        ' }; })()';
    // eslint-disable-next-line no-eval
    return eval(wrapper);
}

// Mirror the browser's processNode() used in handleFileUpload so .docx tests
// go through the same tree-to-text conversion.
function processNode(node) {
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType === 1) {
        const tag = node.tagName.toLowerCase();
        let content = '';
        for (const child of node.childNodes) content += processNode(child);
        switch (tag) {
            case 'strong': case 'b': return `<strong>${content}</strong>`;
            case 'em': case 'i':     return `<em>${content}</em>`;
            case 'u':                return `<u>${content}</u>`;
            case 'sup':              return `<sup>${content}</sup>`;
            case 'sub':              return `<sub>${content}</sub>`;
            case 'code':             return `<code>${content}</code>`;
            case 'p': case 'li':     return content + '\n';
            case 'br':               return '\n';
            default:                 return content;
        }
    }
    return '';
}

export async function docxToText(docxPath) {
    const buffer = readFileSync(docxPath);
    const result = await mammoth.convertToHtml({ buffer }, {
        styleMap: [
            "p[style-name='Heading 1'] => h1:fresh",
            "p[style-name='Heading 2'] => h2:fresh",
            "b => strong",
            "i => em",
            "u => u"
        ]
    });
    const parsedDoc = new DOMParser().parseFromString(
        `<!doctype html><body>${result.value}</body>`, 'text/html'
    );
    const body = parsedDoc.body;
    let text = '';
    const paragraphs = body.querySelectorAll('p, li');
    if (paragraphs.length > 0) {
        paragraphs.forEach(p => {
            const processed = processNode(p);
            if (processed.trim()) text += processed;
        });
    } else {
        text = processNode(body);
    }
    return text;
}

// Tiny assertion helpers so individual tests stay readable.
export class TestRunner {
    constructor(label) {
        this.label = label;
        this.passed = 0;
        this.failed = 0;
        this.failures = [];
    }

    case(name, fn) {
        try {
            fn();
            this.passed++;
        } catch (err) {
            this.failed++;
            this.failures.push({ name, message: err.message, stack: err.stack });
        }
    }

    async caseAsync(name, fn) {
        try {
            await fn();
            this.passed++;
        } catch (err) {
            this.failed++;
            this.failures.push({ name, message: err.message, stack: err.stack });
        }
    }

    report() {
        const total = this.passed + this.failed;
        const prefix = this.failed === 0 ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
        console.log(`${prefix} ${this.label}: ${this.passed}/${total} passed`);
        for (const f of this.failures) {
            console.log(`  \x1b[31m✗\x1b[0m ${f.name}`);
            console.log(`     ${f.message}`);
        }
        return this.failed === 0;
    }
}

export function assert(condition, message) {
    if (!condition) {
        throw new Error(message || 'assertion failed');
    }
}

export function assertEqual(actual, expected, message) {
    const aJson = JSON.stringify(actual);
    const eJson = JSON.stringify(expected);
    if (aJson !== eJson) {
        throw new Error(
            (message ? message + ': ' : '') +
            `expected ${eJson}, got ${aJson}`
        );
    }
}
