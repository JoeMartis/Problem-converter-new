// OLX Problem Converter - core logic
// Extracted from index.html in v5.0.0-alpha (Phase 2 of refactor).
// All functions remain in global scope so inline onclick handlers in
// index.html continue to work without modification.

let currentProblems = [];
// Library metadata captured at parse time so that a later download can use
// the same org / id / name the user saw in the preview, even if the input
// textarea has been edited or cleared since the conversion.
let currentLibraryMeta = null;
// Warnings surfaced after the latest conversion (parser + validation).
let currentWarnings = [];
let currentPreviewIndex = 0;
let showAllMode = true;
let previewEnabled = true;
let savedSelection = null;
let editListenersInitialized = false;

function escapeXml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

// Allowlist-based HTML sanitizer for contenteditable content and
// untrusted HTML from Mammoth. Preserves formatting tags we support.
const SANITIZE_ALLOWED_TAGS = new Set([
    'STRONG', 'EM', 'U', 'SUP', 'SUB', 'CODE', 'A', 'B', 'I',
    'PRE', 'BR', 'UL', 'OL', 'LI', 'P', 'SPAN', 'DIV',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6'
]);
const SANITIZE_ALLOWED_ATTRS = {
    'A': new Set(['href', 'target', 'rel']),
    'CODE': new Set(['class', 'data-language'])
};

function sanitizeHtml(html) {
    if (html === null || html === undefined) return '';
    const template = document.createElement('template');
    template.innerHTML = String(html);
    sanitizeNode(template.content);
    return template.innerHTML;
}

const SANITIZE_DROP_SUBTREE = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM']);

function sanitizeNode(root) {
    const walker = [];
    const collect = (node) => {
        for (let i = node.childNodes.length - 1; i >= 0; i--) {
            walker.push(node.childNodes[i]);
        }
    };
    collect(root);
    while (walker.length) {
        const node = walker.pop();
        if (node.nodeType === Node.ELEMENT_NODE) {
            const tag = node.tagName;
            if (SANITIZE_DROP_SUBTREE.has(tag)) {
                node.parentNode.removeChild(node);
                continue;
            }
            if (!SANITIZE_ALLOWED_TAGS.has(tag)) {
                const parent = node.parentNode;
                while (node.firstChild) parent.insertBefore(node.firstChild, node);
                parent.removeChild(node);
                continue;
            }
            const allowedAttrs = SANITIZE_ALLOWED_ATTRS[tag] || new Set();
            for (let i = node.attributes.length - 1; i >= 0; i--) {
                const attr = node.attributes[i];
                const name = attr.name.toLowerCase();
                if (!allowedAttrs.has(name)) {
                    node.removeAttribute(attr.name);
                    continue;
                }
                if (name === 'href') {
                    // Whitelist safe schemes. Accept scheme-relative
                    // and relative URLs too. Everything else (js:,
                    // data:, blob:, filesystem:, vbscript:, ...) is
                    // dropped.
                    const value = attr.value.trim();
                    const schemeMatch = value.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
                    const scheme = schemeMatch ? schemeMatch[1].toLowerCase() : null;
                    const isSafe = !scheme ||
                        scheme === 'http' ||
                        scheme === 'https' ||
                        scheme === 'mailto' ||
                        scheme === 'tel' ||
                        value.startsWith('//') ||
                        value.startsWith('/') ||
                        value.startsWith('#');
                    if (!isSafe) {
                        node.removeAttribute(attr.name);
                    }
                }
            }
            collect(node);
        }
    }
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function escapeHtmlWithFormatting(text) {
    if (!text) return '';

    const tagPlaceholders = {};
    let placeholderIndex = 0;
    // Per-call random suffix so that literal text like "__LATEX_0__"
    // in user input can't collide with an internal placeholder.
    const seed = Math.random().toString(36).slice(2, 10);

    // Protect \begin{center}...\end{center} blocks BEFORE converting line breaks
    // This preserves the entire block including newlines exactly as-is
    text = text.replace(/\\begin\{center\}([\s\S]*?)\\end\{center\}/g, (match, content) => {
        const placeholder = `__CENTER_${seed}_${placeholderIndex}__`;
        tagPlaceholders[placeholder] = match; // Keep the entire block unchanged
        placeholderIndex++;
        return placeholder;
    });

    // Convert markdown-style bullet lists to HTML before line break conversion
    // Detect consecutive lines starting with - or * followed by space
    const lines = text.split('\n');
    let inList = false;
    let processedLines = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isBullet = /^\s*[-*]\s+(.+)/.test(line);

        if (isBullet) {
            const bulletContent = line.replace(/^\s*[-*]\s+/, '');
            if (!inList) {
                processedLines.push('<ul>');
                inList = true;
            }
            processedLines.push(`<li>${escapeHtml(bulletContent)}</li>`);
        } else {
            if (inList && line.trim() === '') {
                // Empty line ends the list
                processedLines.push('</ul>');
                inList = false;
            } else if (inList && line.trim() !== '') {
                // Non-empty, non-bullet line ends the list
                processedLines.push('</ul>');
                inList = false;
                processedLines.push(line);
            } else {
                processedLines.push(line);
            }
        }
    }

    // Close any unclosed list
    if (inList) {
        processedLines.push('</ul>');
    }

    text = processedLines.join('\n');

    // Convert markdown-style code to HTML before other processing
    // Triple backticks for code blocks (must come before single backticks)
    text = text.replace(/```([^`]+?)```/g, '<pre><code>$1</code></pre>');
    // Single backticks for inline code
    text = text.replace(/`([^`]+?)`/g, '<code>$1</code>');

    // Allow safe formatting tags: strong, em, u, sup, sub, code, a, b, i, pre, br, ul, li
    const allowedTags = ['strong', 'em', 'u', 'sup', 'sub', 'code', 'a', 'b', 'i', 'pre', 'br', 'ul', 'li'];
    let result = text;

    // Protect <ul>...</ul> blocks BEFORE converting line breaks
    // This prevents <br/> tags from being inserted between list elements
    result = result.replace(/<ul>([\s\S]*?)<\/ul>/gi, (match) => {
        const placeholder = `__UL_${seed}_${placeholderIndex}__`;
        tagPlaceholders[placeholder] = match;
        placeholderIndex++;
        return placeholder;
    });

    // Convert line breaks to <br/> tags after protecting list structures
    result = result.replace(/\n/g, '<br/>');

    // Protect LaTeX expressions (both inline and display)
    // Inline: \( ... \) or $ ... $
    // Display: \[ ... \] or $$ ... $$
    const latexPatterns = [
        { regex: /\\\[([\s\S]*?)\\\]/g, prefix: '\\[', suffix: '\\]' },
        { regex: /\\\(([\s\S]*?)\\\)/g, prefix: '\\(', suffix: '\\)' },
        { regex: /\$\$([\s\S]*?)\$\$/g, prefix: '$$', suffix: '$$' },
        { regex: /\$([^\$\n]+?)\$/g, prefix: '$', suffix: '$' }
    ];

    latexPatterns.forEach(pattern => {
        result = result.replace(pattern.regex, (match, content) => {
            const placeholder = `__LATEX_${seed}_${placeholderIndex}__`;
            tagPlaceholders[placeholder] = pattern.prefix + content + pattern.suffix;
            placeholderIndex++;
            return placeholder;
        });
    });

    // Protect anchor tags with href
    const anchorRegex = /<a\s+href="([^"]+)"(?:\s+target="([^"]+)")?(?:\s+rel="([^"]+)")?[^>]*>(.*?)<\/a>/gi;
    result = result.replace(anchorRegex, (match, href, target, rel, content) => {
        const placeholder = `__ANCHOR_${seed}_${placeholderIndex}__`;
        const escapedHref = escapeHtml(href);
        const escapedContent = escapeHtml(content);
        let tag = `<a href="${escapedHref}"`;
        if (target) {
            tag += ` target="${escapeHtml(target)}"`;
        }
        if (rel) {
            tag += ` rel="${escapeHtml(rel)}"`;
        }
        tag += `>${escapedContent}</a>`;
        tagPlaceholders[placeholder] = tag;
        placeholderIndex++;
        return placeholder;
    });

    // Protect <br/> tags (self-closing)
    result = result.replace(/<br\s*\/?>/gi, () => {
        const placeholder = `__BR_${seed}_${placeholderIndex}__`;
        tagPlaceholders[placeholder] = '<br/>';
        placeholderIndex++;
        return placeholder;
    });

    // Protect other allowed tags
    allowedTags.forEach(tag => {
        if (tag === 'a' || tag === 'br') return; // Already handled
        const tagRegex = new RegExp(`<${tag}>(.*?)<\/${tag}>`, 'gi');
        result = result.replace(tagRegex, (match, content) => {
            const placeholder = `__TAG_${seed}_${placeholderIndex}__`;
            tagPlaceholders[placeholder] = `<${tag}>${content}</${tag}>`;
            placeholderIndex++;
            return placeholder;
        });
    });

    // Escape everything else
    result = escapeHtml(result);

    // Restore protected tags
    Object.keys(tagPlaceholders).forEach(placeholder => {
        result = result.replace(placeholder, tagPlaceholders[placeholder]);
    });

    return result;
}

function escapeXmlWithFormatting(text) {
    if (!text) return '';

    const tagPlaceholders = {};
    let placeholderIndex = 0;
    // Per-call random suffix so literal text like "__LATEX_0__" in
    // user input cannot collide with an internal placeholder.
    const seed = Math.random().toString(36).slice(2, 10);

    // Protect \begin{center}...\end{center} blocks BEFORE converting line breaks
    // This preserves the entire block including newlines exactly as-is
    text = text.replace(/\\begin\{center\}([\s\S]*?)\\end\{center\}/g, (match, content) => {
        const placeholder = `__CENTER_${seed}_${placeholderIndex}__`;
        tagPlaceholders[placeholder] = match; // Keep the entire block unchanged
        placeholderIndex++;
        return placeholder;
    });

    // Convert markdown-style bullet lists to HTML before line break conversion
    // Detect consecutive lines starting with - or * followed by space
    const lines = text.split('\n');
    let inList = false;
    let processedLines = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isBullet = /^\s*[-*]\s+(.+)/.test(line);

        if (isBullet) {
            const bulletContent = line.replace(/^\s*[-*]\s+/, '');
            if (!inList) {
                processedLines.push('<ul>');
                inList = true;
            }
            processedLines.push(`<li>${escapeXml(bulletContent)}</li>`);
        } else {
            if (inList && line.trim() === '') {
                // Empty line ends the list
                processedLines.push('</ul>');
                inList = false;
            } else if (inList && line.trim() !== '') {
                // Non-empty, non-bullet line ends the list
                processedLines.push('</ul>');
                inList = false;
                processedLines.push(line);
            } else {
                processedLines.push(line);
            }
        }
    }

    // Close any unclosed list
    if (inList) {
        processedLines.push('</ul>');
    }

    text = processedLines.join('\n');

    // Convert markdown-style code to HTML before other processing
    // Triple backticks for code blocks (must come before single backticks)
    text = text.replace(/```([^`]+?)```/g, '<pre><code>$1</code></pre>');
    // Single backticks for inline code
    text = text.replace(/`([^`]+?)`/g, '<code>$1</code>');

    const allowedTags = ['strong', 'em', 'u', 'sup', 'sub', 'code', 'a', 'b', 'i', 'pre', 'br', 'ul', 'li'];
    let guarded = text;

    // Protect <ul>...</ul> blocks BEFORE converting line breaks
    // This prevents <br/> tags from being inserted between list elements
    guarded = guarded.replace(/<ul>([\s\S]*?)<\/ul>/gi, (match) => {
        const placeholder = `__UL_${seed}_${placeholderIndex}__`;
        tagPlaceholders[placeholder] = match;
        placeholderIndex++;
        return placeholder;
    });

    // Convert line breaks to <br/> tags after protecting list structures
    guarded = guarded.replace(/\n/g, '<br/>');

    // Protect LaTeX expressions (both inline and display)
    const latexPatterns = [
        { regex: /\\\[([\s\S]*?)\\\]/g, prefix: '\\[', suffix: '\\]' },
        { regex: /\\\(([\s\S]*?)\\\)/g, prefix: '\\(', suffix: '\\)' },
        { regex: /\$\$([\s\S]*?)\$\$/g, prefix: '$$', suffix: '$$' },
        { regex: /\$([^\$\n]+?)\$/g, prefix: '$', suffix: '$' }
    ];

    latexPatterns.forEach(pattern => {
        guarded = guarded.replace(pattern.regex, (match, content) => {
            const placeholder = `__LATEX_${seed}_${placeholderIndex}__`;
            tagPlaceholders[placeholder] = pattern.prefix + content + pattern.suffix;
            placeholderIndex++;
            return placeholder;
        });
    });

    // Protect anchor tags with href and optional target. Attribute values
    // must be XML-escaped: the source regex only rejects `"` inside values,
    // so `<`, `>`, `&` can still reach the placeholder and end up emitted
    // as raw characters if not escaped here.
    const anchorRegex = /<a\s+href="([^"]+)"(?:\s+target="([^"]+)")?(?:\s+rel="([^"]+)")?[^>]*>(.*?)<\/a>/gi;
    guarded = guarded.replace(anchorRegex, (match, href, target, rel, content) => {
        const placeholder = `__ANCHOR_${seed}_${placeholderIndex}__`;
        let tag = `<a href="${escapeXml(href)}"`;
        if (target) {
            tag += ` target="${escapeXml(target)}"`;
        }
        if (rel) {
            tag += ` rel="${escapeXml(rel)}"`;
        }
        tag += `>${content}</a>`;
        tagPlaceholders[placeholder] = tag;
        placeholderIndex++;
        return placeholder;
    });

    // Protect pre>code blocks. Same attribute-escape concern as anchors.
    const preCodeRegex = /<pre><code(?:\s+class="([^"]+)")?(?:\s+data-language="([^"]+)")?>([\s\S]*?)<\/code><\/pre>/gi;
    guarded = guarded.replace(preCodeRegex, (match, className, lang, content) => {
        const placeholder = `__PRECODE_${seed}_${placeholderIndex}__`;
        let tag = '<pre><code';
        if (className) {
            tag += ` class="${escapeXml(className)}"`;
        }
        if (lang) {
            tag += ` data-language="${escapeXml(lang)}"`;
        }
        // Escape the content inside code blocks
        const escapedContent = content
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        tag += `>${escapedContent}</code></pre>`;
        tagPlaceholders[placeholder] = tag;
        placeholderIndex++;
        return placeholder;
    });

    // Protect <br/> tags (self-closing)
    guarded = guarded.replace(/<br\s*\/?>/gi, () => {
        const placeholder = `__BR_${seed}_${placeholderIndex}__`;
        tagPlaceholders[placeholder] = '<br/>';
        placeholderIndex++;
        return placeholder;
    });

    allowedTags.forEach(tag => {
        if (tag === 'a' || tag === 'pre' || tag === 'br') return; // Already handled
        const openRegex = new RegExp(`<${tag}>`, 'gi');
        const closeRegex = new RegExp(`</${tag}>`, 'gi');

        guarded = guarded.replace(openRegex, () => {
            const placeholder = `__PLACEHOLDER_${seed}_${placeholderIndex}__`;
            tagPlaceholders[placeholder] = `<${tag}>`;
            placeholderIndex++;
            return placeholder;
        });

        guarded = guarded.replace(closeRegex, () => {
            const placeholder = `__PLACEHOLDER_${seed}_${placeholderIndex}__`;
            tagPlaceholders[placeholder] = `</${tag}>`;
            placeholderIndex++;
            return placeholder;
        });
    });
    
    guarded = String(guarded)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    
    Object.keys(tagPlaceholders).forEach(placeholder => {
        guarded = guarded.replace(placeholder, tagPlaceholders[placeholder]);
    });
    
    return guarded;
}

function cleanText(text) {
    if (!text) return '';
    return text
        .replace(/\*\*/g, '')
        .replace(/\{\.underline\}/g, '')
        .replace(/\{\.mark\}/g, '')
        // Drop empty emphasis wrappers left behind after marker removal.
        .replace(/<(strong|em|u|b|i|sup|sub)>\s*<\/\1>/gi, '')
        .trim();
}

// Produce a filesystem-safe filename while preserving Unicode letters
// and digits. Falls back to ASCII-only when Unicode property classes
// aren't supported.
// Greek / Cyrillic uppercase letters that look identical to Latin A-Z.
// Used to normalize "Correct: A" lines pasted from Word/Greek keyboards.
const LATIN_LOOKALIKES = {
    'Α':'A','Β':'B','Ε':'E','Ζ':'Z','Η':'H','Ι':'I','Κ':'K','Μ':'M',
    'Ν':'N','Ο':'O','Ρ':'P','Τ':'T','Υ':'Y','Χ':'X',
    'А':'A','В':'B','Е':'E','К':'K','М':'M','Н':'H','О':'O','Р':'P',
    'С':'C','Т':'T','У':'Y','Х':'X'
};

function normalizeCorrectLetters(str) {
    if (!str) return '';
    // NFKC handles full-width A-Z; explicit map covers Greek/Cyrillic.
    let s;
    try { s = str.normalize('NFKC'); } catch (e) { s = str; }
    s = s.toUpperCase();
    return s.replace(/./g, ch => LATIN_LOOKALIKES[ch] || ch);
}

function makeSafeFilename(name) {
    if (!name) return 'library';
    const trimmed = String(name).trim().replace(/\s+/g, '_');
    let safe;
    try {
        safe = trimmed.replace(/[^\p{L}\p{N}_-]/gu, '_');
    } catch (e) {
        safe = trimmed.replace(/[^a-zA-Z0-9_-]/g, '_');
    }
    // Avoid leading dots / reserved names; cap length
    safe = safe.replace(/^\.+/, '_').slice(0, 100);
    return safe || 'library';
}

/**
 * Determines if a problem should be treated as multiple choice or checkbox
 * based on question text and correct answer count
 */
function isProblemMultipleChoice(questionText, correctIndicesCount) {
    // Check if question explicitly asks for multiple selections
    const selectAllPattern = /\(select all that apply\.?\)/i;
    if (selectAllPattern.test(questionText)) {
        return false; // Checkbox format for "select all that apply"
    }

    // Default behavior: single answer = multiple choice, multiple = checkbox
    return correctIndicesCount <= 1;
}

// Mammoth (Word .docx -> HTML) often wraps markers like "(correct)" or
// "Explanation" in <strong>...</strong>, sometimes across a newline.
// Normalize so marker detection works against plain text without
// destroying intentional emphasis inside question / choice text.
function preNormalizeEmphasis(text) {
    if (!text) return text;

    // Join emphasis tags whose content spans newlines:
    // "<strong>(correct)\n</strong>" -> "<strong>(correct)</strong>".
    for (let i = 0; i < 4; i++) {
        const before = text;
        text = text.replace(
            /<(strong|em|u|b|i|sup|sub)>([^<]*?)\s*\n\s*<\/\1>/gi,
            '<$1>$2</$1>'
        );
        if (text === before) break;
    }

    // Drop empty emphasis tag pairs BEFORE the unwrap step so an
    // adjacent "<strong></strong>" cannot let the unwrap regex
    // span multiple tags and swallow a legitimate marker.
    text = text.replace(/<(strong|em|u|b|i|sup|sub)>\s*<\/\1>/gi, '');

    // Unwrap emphasis tags whose inner content begins with a known
    // section marker (Correct, Answer, Explanation) or is a Q-style
    // label, so pattern matching on plain text keeps working when
    // authors bold the whole marker line such as
    // "<strong>Correct: B</strong>" or "<strong>Explanation: ...</strong>".
    // Intentional emphasis inside ordinary question / choice text is
    // left alone. Using [^<] keeps the match anchored to a single
    // tag - worth the small loss of "unwrap when <br/> is inside
    // the marker" in exchange for deterministic behavior.
    text = text.replace(
        /<(strong|em|u|b|i)>([^<]{1,2000})<\/\1>/gi,
        (match, tag, content) => {
            const stripped = content.trim();
            if (/^\(correct(\s+answer)?\)$/i.test(stripped) ||
                /^(Explanation|Explain|Answer|Correct)\s*(:|$)/i.test(stripped) ||
                /^Q\d+[-–—][A-Za-z0-9]+\s*(\(.*\))?$/.test(stripped)) {
                return content;
            }
            return match;
        }
    );

    // Second pass: remove any empty emphasis tag pairs that unwrap
    // left behind (e.g. "<strong>(correct)</strong>" after the marker
    // itself was stripped elsewhere).
    text = text.replace(/<(strong|em|u|b|i|sup|sub)>\s*<\/\1>/gi, '');

    return text;
}

// Turn LaTeX-labelled multiple-choice math into "X. <latex>" lines that
// the ordinary choice-parser already understands. Handles two common
// authoring patterns seen in real .docx sources.
function normalizeLatexChoices(text) {
    if (!text) return text;

    // Pattern 1: a single align / align* / aligned environment that
    // contains multiple "\mathbf{(X)}" labels. Split by label.
    text = text.replace(
        /\\begin\{(align\*?|aligned)\}([\s\S]*?)\\end\{\1\}/g,
        (match, env, inner) => {
            const labelRe = /\\mathbf\{\(([A-Z])\)\}/g;
            const labels = [];
            let m;
            while ((m = labelRe.exec(inner)) !== null) {
                labels.push({ letter: m[1], start: m.index, end: m.index + m[0].length });
            }
            if (labels.length < 2) return match;
            const out = [];
            for (let i = 0; i < labels.length; i++) {
                const from = labels[i].end;
                const to = i + 1 < labels.length ? labels[i + 1].start : inner.length;
                let content = inner.substring(from, to)
                    .replace(/\s*\n\s*/g, ' ')       // flatten so the choice fits on one line
                    .replace(/\s+/g, ' ')
                    .replace(/\\\\\s*$/, '')         // drop trailing alignment separator
                    .trim();
                if (!content) continue;
                out.push(labels[i].letter + '. $$\\begin{aligned} ' + content + ' \\end{aligned}$$');
            }
            return '\n' + out.join('\n') + '\n';
        }
    );

    // Pattern 2: "$$...\mathbf{(X)}...$$" blocks each carrying one label.
    // Rewrite to "X. $$...$$" lines so the choice-letter pattern fires.
    text = text.replace(/\$\$([\s\S]*?)\$\$/g, (match, inner) => {
        const labelMatch = inner.match(/\\mathbf\{\(([A-Z])\)\}/);
        if (!labelMatch) return match;
        const letter = labelMatch[1];
        const cleaned = inner
            .replace(/\\mathbf\{\([A-Z]\)\}\s*/, '')
            .replace(/\s*\n\s*/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return '\n' + letter + '. $$' + cleaned + '$$\n';
    });

    return text;
}

// ---------------------------------------------------------------------------
// parseProblems (v5): rewritten around an explicit state object and a single
// finalizeProblem() helper. Same public signature and same behavior as the
// v4 implementation - regression covered by test/parser.test.mjs and
// test/assignments.test.mjs.
//
// State lives entirely inside a `ctx` object so every line handler operates
// on the same piece of memory. The main loop dispatches line-by-line through
// an ordered list of handlers; the first handler that claims a line wins.
// ---------------------------------------------------------------------------

function parseProblems(text) {
    const normalizedText = normalizeLatexChoices(preNormalizeEmphasis(text))
        .replace(/(^|\s)(\d+\.\s+[A-Z])/g, '$1\n$2')
        .replace(/(Part\s+\d+\s+Question\s+\d+)/gi, '\n\n$1\n')
        .replace(/(\*\*Original:)/gi, '\n\n$1');

    const lines = normalizedText.split('\n');
    const header = parseHeaderMetadata(lines);

    const ctx = {
        out: {
            problems: [],
            // Held empty during parsing so the `Problem N` fallback in
            // finalizeProblem fires when no label is present. Defaulted to
            // 'Problem' only at return time below.
            displayNameLabel: header.displayNameLabel,
            libraryOrg: header.libraryOrg,
            libraryName: header.libraryName,
            libraryId: header.libraryId,
            // Parser + validation warnings surfaced to the UI. Each entry
            // is { problemIndex, code, message, severity } where
            // severity is 'warn' or 'info'. problemIndex === -1 means
            // the warning isn't tied to a specific problem.
            warnings: [],
        },
        questionText: '',
        choices: [],
        correctIndices: [],
        explanation: '',
        currentLabel: '',
        pendingAnswer: null,
        problemCount: 0,
        // Transient flags (set by handlers, read by handlers):
        inChoices: false,
        explanationEnded: false,
        questionEnded: false,
        awaitingQuestionBody: false,
    };

    for (let i = header.startIndex; i < lines.length; i++) {
        processLine(ctx, lines[i].trim());
    }
    finalizeProblem(ctx);

    // Post-parse validation surfaced alongside the parser warnings.
    validateProblems(ctx.out.problems, ctx.out.warnings);

    if (!ctx.out.displayNameLabel) ctx.out.displayNameLabel = 'Problem';
    return ctx.out;
}

// --- post-parse validation: catches shape issues that individual handlers
// ---  can't know about until the whole problem is assembled -----------------

function validateProblems(problems, warnings) {
    const push = (problemIndex, code, severity, message) =>
        warnings.push({ problemIndex, code, severity, source: 'validator', message });

    problems.forEach((p, i) => {
        const hasChoices = p.choices && p.choices.length > 0;
        const hasAnswer = p.answer !== undefined && p.answer !== '';
        const hasCorrect = (p.correctIndices && p.correctIndices.length > 0);
        const placeholder = (p.explanation || '').trim() === 'Add your explanation here';

        if (!p.question || !p.question.trim()) {
            push(i, 'empty_question', 'warn', 'Problem has no question text.');
        }
        if (!hasChoices && !hasAnswer) {
            push(i, 'no_content', 'warn', 'No choices or answer detected.');
        }
        if (hasChoices && !hasCorrect) {
            push(i, 'no_correct_marker', 'warn',
                'Choices were found but no correct answer was marked.');
        }
        if (hasChoices && p.choices.length < 2) {
            push(i, 'too_few_choices', 'warn',
                `Only ${p.choices.length} choice(s) detected - minimum 2 expected.`);
        }
        if (placeholder) {
            push(i, 'missing_explanation', 'info',
                'No explanation text found; the default placeholder will be used.');
        }
        if (hasChoices) {
            p.choices.forEach((c, j) => {
                const letter = String.fromCharCode(65 + j);
                if (!c || !c.trim()) {
                    push(i, 'empty_choice', 'warn', `Choice ${letter} is empty.`);
                } else if (c.length > 400) {
                    push(i, 'choice_too_long', 'info',
                        `Choice ${letter} is unusually long (${c.length} chars) - may indicate explanation text was merged in.`);
                }
            });
        }
    });
}

// --- header pre-scan: org / library id / initial label ---------------------

function parseHeaderMetadata(lines) {
    const header = {
        libraryOrg: 'MITxT',
        libraryName: 'Problem Library',
        libraryId: 'CustomLibrary',
        displayNameLabel: '',
        startIndex: 0,
    };
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        let m;
        if ((m = line.match(/^(.+?):\s*([A-Z0-9_]+)$/)) && m[2].match(/^[A-Z0-9_]+$/)) {
            header.libraryName = m[1].trim();
            header.libraryId = m[2].trim();
            continue;
        }
        if ((m = line.match(/^Organization:\s*(.+?)(?:,|$)/i)))     { header.libraryOrg = m[1].trim(); continue; }
        if ((m = line.match(/Legacy Library Name:\s*(.+?)(?:,|$)/i))) { header.libraryName = m[1].trim(); continue; }
        if ((m = line.match(/Library ID:\s*(.+?)(?:,|$)/i)))         { header.libraryId = m[1].trim(); continue; }
        if ((m = line.match(/^Label:\s*(.+)/i))) {
            header.displayNameLabel = m[1].trim();
            header.startIndex = i + 1;
            return header;
        }
        if ((m = line.match(/^Part\s+\d+\s+Question\s+\d+/i))) {
            header.displayNameLabel = line.trim();
            header.startIndex = i + 1;
            return header;
        }
        if (line.match(/^Part\s+\d+$/i)) continue;
        if (line.match(/^Q\d+-[A-Za-z0-9]+(\s*\(.*\))?$/)) { header.startIndex = i; return header; }
        if (line.endsWith('?') || line.match(/^\d+\.\s+/) || line.match(/^Original:/i)) {
            header.startIndex = i;
            return header;
        }
    }
    return header;
}

// --- single place to push a completed problem and reset field state --------

function finalizeProblem(ctx) {
    const title = ctx.currentLabel || ctx.out.displayNameLabel || `Problem ${ctx.problemCount + 1}`;
    if (ctx.pendingAnswer) {
        ctx.problemCount++;
        ctx.out.problems.push({
            title,
            question: cleanText(ctx.pendingAnswer.questionText),
            answer: ctx.pendingAnswer.answerValue,
            answerType: ctx.pendingAnswer.answerType,
            choices: [],
            correctIndices: [],
            isMultipleChoice: false,
            explanation: ctx.explanation ? cleanText(ctx.explanation) : 'Add your explanation here',
        });
        ctx.pendingAnswer = null;
    } else if (ctx.questionText && ctx.choices.length > 0) {
        ctx.problemCount++;
        ctx.out.problems.push({
            title,
            question: cleanText(ctx.questionText),
            choices: ctx.choices.map(c => cleanText(c.text)),
            correctIndices: ctx.correctIndices,
            isMultipleChoice: isProblemMultipleChoice(ctx.questionText, ctx.correctIndices.length),
            explanation: ctx.explanation ? cleanText(ctx.explanation) : 'Add your explanation here',
        });
    }
    // Reset per-problem state. currentLabel is preserved so that a stray label
    // emitted between problems doesn't get overwritten - callers that see a
    // new label set it explicitly.
    ctx.questionText = '';
    ctx.choices = [];
    ctx.correctIndices = [];
    ctx.explanation = '';
    ctx.inChoices = false;
    ctx.explanationEnded = false;
    ctx.questionEnded = false;
    ctx.awaitingQuestionBody = false;
}

// --- ordered line handlers. First one to return true claims the line ------

function processLine(ctx, line) {
    const handlers = [
        handleLabelLine,
        handlePartQuestionLine,
        handleSectionHeaderLine,
        handleQLabelLine,
        handleBlankLine,
        handleOriginalLine,
        handleNumberedQuestionLine,
        handleQuestionLine,
        handleAnswerLine,
        handleCorrectLine,
        handleExplanationStartLine,
        handleEndExplanationLine,
        handleEndQuestionLine,
        handleExplanationContinuation,
        handleChoiceLine,
        handleSetupFallthrough,
    ];
    for (const h of handlers) if (h(ctx, line)) return;
}

function handleLabelLine(ctx, line) {
    const m = line.match(/^Label:\s*(.+)/i);
    if (!m) return false;
    // Label applies to the NEXT problem. Finalize in-progress choice-based
    // problem (text/numerical problems with pendingAnswer are NOT finalized
    // here - preserves original v4 behavior).
    if (ctx.questionText && ctx.choices.length > 0) finalizeProblem(ctx);
    ctx.currentLabel = m[1].trim();
    return true;
}

function handlePartQuestionLine(ctx, line) {
    if (!line.match(/^Part\s+\d+\s+Question\s+\d+/i)) return false;
    if (ctx.questionText && ctx.choices.length > 0) finalizeProblem(ctx);
    ctx.currentLabel = line;
    return true;
}

function handleSectionHeaderLine(ctx, line) {
    // "Q1 – Topic" with spaces around the dash is just a section heading.
    return /^Q\d+\s+[-–—]\s+/.test(line);
}

function handleQLabelLine(ctx, line) {
    const m = line.match(/^(Q\d+[-–—][A-Za-z0-9]+)\s*(\(.*\))?$/);
    if (!m) return false;
    finalizeProblem(ctx);
    ctx.currentLabel = m[1].trim();
    ctx.awaitingQuestionBody = true;
    return true;
}

function handleBlankLine(ctx, line) {
    // Blank lines do not trigger finalization (choices may have blanks
    // between them in some author styles).
    return line === '';
}

function handleOriginalLine(ctx, line) {
    const m = line.match(/^Original:\s*(.+)/i) || line.match(/^\*\*Original:\s*(.+)/i);
    if (!m) return false;
    if (ctx.questionText && ctx.choices.length > 0) finalizeProblem(ctx);
    ctx.questionText = m[1];
    ctx.inChoices = true;
    ctx.explanationEnded = false;
    ctx.questionEnded = false;
    return true;
}

function handleNumberedQuestionLine(ctx, line) {
    const m = line.match(/^\d+\.\s+(.+)/);
    if (!m) return false;
    if (ctx.questionText && ctx.choices.length > 0) finalizeProblem(ctx);
    ctx.questionText = m[1];
    ctx.inChoices = true;
    ctx.explanationEnded = false;
    ctx.questionEnded = false;
    return true;
}

function handleQuestionLine(ctx, line) {
    const selectAllPattern = /\(select all that apply\.?\)$/i;
    const looksQuestion = (line.endsWith('?') || line.includes('?') || selectAllPattern.test(line)) &&
                          !line.toLowerCase().startsWith('explanation');
    if (!looksQuestion) return false;

    // finalizeProblem handles both the pending-answer and
    // question+choices cases; a single call covers both transitions.
    if (ctx.pendingAnswer || (ctx.questionText && ctx.choices.length > 0)) {
        finalizeProblem(ctx);
    }

    // When we've been accumulating multi-line setup text before the "?" line,
    // concatenate instead of replacing so the whole question body survives.
    const stillAccumulating = ctx.questionText && ctx.choices.length === 0 && !ctx.pendingAnswer;
    if ((ctx.explanationEnded || stillAccumulating) && ctx.questionText) {
        ctx.questionText = ctx.questionText + ' ' + line;
        ctx.explanationEnded = false;
        ctx.questionEnded = false;
    } else {
        ctx.questionText = line;
    }
    ctx.awaitingQuestionBody = false;
    ctx.inChoices = true;
    return true;
}

function handleAnswerLine(ctx, line) {
    // "Answer:" line accepted case-insensitively, but an inline "Explanation:"
    // split only triggers on the canonical capital-E form - preserves answer
    // text that contains the word "explanation:" in lowercase.
    const prefix = line.match(/^Answer:\s*(.+)$/i);
    if (!prefix) return false;
    if (!ctx.questionText || ctx.choices.length !== 0) return false; // not an answer-line context

    if (ctx.pendingAnswer) finalizeProblem(ctx);

    const rest = prefix[1];
    const splitMatch = rest.match(/^(.+?)\s+Explanation:\s+(.+)$/);
    const answerValue = (splitMatch ? splitMatch[1] : rest).trim();
    const inlineExplanation = splitMatch ? splitMatch[2].trim() : '';
    const isNumerical = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(answerValue);

    // Route both paths through finalizeProblem so title/flag-reset logic lives
    // in exactly one place. The "inline explanation" case finalizes
    // immediately; otherwise we stash pendingAnswer and wait for an
    // Explanation: line on a subsequent iteration.
    ctx.pendingAnswer = {
        questionText: ctx.questionText,
        answerValue,
        answerType: isNumerical ? 'numerical' : 'text',
    };
    ctx.questionText = '';
    if (inlineExplanation || ctx.explanation) {
        ctx.explanation = inlineExplanation || ctx.explanation;
        finalizeProblem(ctx);
    } else {
        // Answer captured; we're no longer in choice-accumulation mode and
        // any prior end-of-explanation / end-of-question markers no longer
        // apply to the pending text-answer problem.
        ctx.inChoices = false;
        ctx.explanationEnded = false;
        ctx.questionEnded = false;
    }
    return true;
}

function handleCorrectLine(ctx, line) {
    // "Correct: A, C" or "Answer: B" used as a correct-answer marker after
    // a choice block.
    const m = line.match(/^(Correct|Answer):\s*(.+)/i);
    if (!m) return false;
    if (!ctx.questionText || ctx.choices.length === 0) return false;

    const rawLetters = m[2].trim();
    const normalized = normalizeCorrectLetters(rawLetters);
    const letterMatches = normalized.match(/[A-Z]/g);
    if (letterMatches && letterMatches.length > 0) {
        const parsed = letterMatches.map(letter => letter.charCodeAt(0) - 'A'.charCodeAt(0));
        const outOfRange = parsed.filter(idx => idx < 0 || idx >= ctx.choices.length);
        if (outOfRange.length > 0) {
            const letters = outOfRange.map(idx => String.fromCharCode(65 + idx)).join(', ');
            ctx.out.warnings.push({
                problemIndex: ctx.problemCount,  // this problem will be pushed next
                code: 'correct_out_of_range',
                severity: 'warn',
                source: 'parser',
                message: `Correct: line references letter(s) ${letters} beyond the ${ctx.choices.length} choice(s) found; dropped.`,
            });
        }
        ctx.correctIndices = parsed.filter(idx => idx >= 0 && idx < ctx.choices.length);
    } else if (rawLetters) {
        ctx.out.warnings.push({
            problemIndex: ctx.problemCount,
            code: 'correct_unparseable',
            severity: 'warn',
            source: 'parser',
            message: `Correct: line has no recognizable A-Z letter (got ${JSON.stringify(rawLetters)}); ignored.`,
        });
    }
    ctx.inChoices = false;
    ctx.questionEnded = false;
    return true;
}

function handleExplanationStartLine(ctx, line) {
    const lower = line.toLowerCase();
    if (!(lower.startsWith('explanation:') || lower.startsWith('explain:') || lower === 'explanation')) {
        return false;
    }
    ctx.inChoices = false;
    ctx.explanationEnded = false;
    ctx.questionEnded = false;
    // Strip any repeated "Explanation:" / "Explain:" prefixes.
    let stripped = line;
    let prev;
    do {
        prev = stripped;
        stripped = stripped.replace(/^(explanation|explain):\s*/i, '');
    } while (stripped !== prev);
    ctx.explanation = (stripped && stripped.toLowerCase() !== 'explanation') ? stripped : '';
    return true;
}

function handleEndExplanationLine(ctx, line) {
    const lower = line.toLowerCase();
    if (!(lower === 'end explanation' || lower.startsWith('end explanation'))) return false;
    if (ctx.questionText && ctx.choices.length > 0) finalizeProblem(ctx);
    ctx.explanationEnded = true;
    ctx.questionEnded = false;
    return true;
}

function handleEndQuestionLine(ctx, line) {
    const lower = line.toLowerCase();
    if (!(lower === 'endquestion' || lower.startsWith('endquestion'))) return false;
    ctx.questionEnded = true;
    ctx.inChoices = true;
    return true;
}

function handleExplanationContinuation(ctx, line) {
    // We're accumulating explanation text when the problem body is complete
    // (choices or pendingAnswer) and we haven't seen "End Explanation".
    const accumulating = !ctx.inChoices && !ctx.explanationEnded &&
                         ((ctx.questionText && ctx.choices.length > 0) || ctx.pendingAnswer);
    if (!accumulating) return false;

    // If the line looks like the START of the next question, finalize and
    // treat this line as the beginning of the next problem's question text.
    const isSetup    = /^(suppose|consider|given|let|assume|if|imagine)\s+/i.test(line);
    const isNewQ     = /^(what|which|why|how|when|where|who|does|is|are|can|should|would|will)\s+/i.test(line);
    if (isSetup || isNewQ) {
        finalizeProblem(ctx);
        ctx.questionText = line;
        return true;
    }
    ctx.explanation += (ctx.explanation ? ' ' : '') + line;
    return true;
}

function handleChoiceLine(ctx, line) {
    if (!(ctx.questionText && ctx.inChoices)) return false;
    // Accept Latin A-Z, Greek Α-Ω, Cyrillic А-Я as prefix letters.
    const choicePattern = /^[A-ZΑ-ΩА-Я]\.\s*/iu;
    const lower = line.toLowerCase();
    const isStopMarker =
        line.match(/^Correct:\s*/i) ||
        lower.startsWith('explanation:') ||
        lower.startsWith('explain:') ||
        lower === 'explanation';
    if (isStopMarker) return false; // let a later handler catch it

    ctx.awaitingQuestionBody = false;
    const isPrefixed = choicePattern.test(line);
    if (!isPrefixed && !line) return false;

    const isCorrect =
        lower.includes('(correct)') ||
        lower.includes('(correct answer)') ||
        line.includes('**(correct');
    let choiceText = line;
    if (isPrefixed) choiceText = choiceText.replace(/^[A-ZΑ-ΩА-Я]\.\s*/iu, '');
    choiceText = choiceText
        .replace(/\*\*\(correct.*?\)\*\*/i, '')
        .replace(/\(correct\s*answer\)/i, '')
        .replace(/\(correct\)/i, '')
        .replace(/\\$/, '')
        .trim();
    if (!choiceText) return true; // consumed but no data added (e.g. "A." on its own)

    if (isCorrect) ctx.correctIndices.push(ctx.choices.length);
    ctx.choices.push({ text: choiceText, correct: isCorrect });
    return true;
}

function handleSetupFallthrough(ctx, line) {
    // Absorbs plain lines into questionText when we're expecting the question
    // body - right after a label (awaitingQuestionBody), right after "End
    // Explanation" (explanationEnded), or mid-accumulation.
    const canAccumulate = (ctx.explanationEnded ||
                           ctx.awaitingQuestionBody ||
                           (ctx.questionText && !ctx.inChoices && ctx.choices.length === 0)) &&
                          !ctx.questionEnded && line &&
                          !line.startsWith('\\section') && !line.startsWith('\\subsection');
    if (!canAccumulate) return false;
    ctx.questionText = ctx.questionText ? ctx.questionText + ' ' + line : line;
    return true;
}

/**
 * Determines the maximum number of attempts allowed based on problem type
 * According to the Attempts Matrix:
 * - Multiple Choice: 2 attempts
 * - Numerical Input: 3 attempts
 * - Standard Checkbox (≤5 correct): 3 attempts
 * - Complex Checkbox (>5 correct): 4 attempts
 */
function getMaxAttempts(problem) {
    // Multiple Choice: 2 attempts
    if (problem.isMultipleChoice) {
        return 2;
    }

    // Numerical Input: 3 attempts
    if (problem.answerType === 'numerical') {
        return 3;
    }

    // Checkbox questions - check number of correct answers
    if (!problem.isMultipleChoice && problem.correctIndices && problem.correctIndices.length > 0) {
        const correctCount = problem.correctIndices.length;
        // Complex Checkbox (>5 correct): 4 attempts
        if (correctCount > 5) {
            return 4;
        }
        // Standard Checkbox (≤5 correct): 3 attempts
        return 3;
    }

    // Default for text input and any other types: 3 attempts
    return 3;
}

function generateOLX(problems) {
    // Use array and join for better performance than string concatenation
    const olxParts = problems.map(problem => {
        const displayName = problem.title;
        const maxAttempts = getMaxAttempts(problem);
        const parts = [];

        if (problem.answerType === 'numerical') {
            parts.push(
                `<problem display_name="${escapeXml(displayName)}" max_attempts="${maxAttempts}" markdown="null">`,
                `  <numericalresponse answer="${escapeXml(problem.answer || '')}">`,
                `    <label>${escapeXmlWithFormatting(problem.question)}</label>`,
                `    <textline/>`,
                `  </numericalresponse>`,
                `  <solution>`,
                `    <div class="detailed-solution">`,
                `      <p>Explanation</p>`,
                `      <p>${escapeXmlWithFormatting(problem.explanation)}</p>`,
                `    </div>`,
                `  </solution>`,
                `</problem>`
            );
        } else if (problem.answerType === 'text') {
            parts.push(
                `<problem display_name="${escapeXml(displayName)}" max_attempts="${maxAttempts}" markdown="null">`,
                `  <stringresponse answer="${escapeXml(problem.answer || '')}" type="ci">`,
                `    <label>${escapeXmlWithFormatting(problem.question)}</label>`,
                `    <textline size="40"/>`,
                `  </stringresponse>`,
                `  <solution>`,
                `    <div class="detailed-solution">`,
                `      <p>Explanation</p>`,
                `      <p>${escapeXmlWithFormatting(problem.explanation)}</p>`,
                `    </div>`,
                `  </solution>`,
                `</problem>`
            );
        } else if (problem.isMultipleChoice) {
            parts.push(
                `<problem display_name="${escapeXml(displayName)}" max_attempts="${maxAttempts}" markdown="null">`,
                `  <multiplechoiceresponse>`,
                `    <label>${escapeXmlWithFormatting(problem.question)}</label>`,
                `    <choicegroup type="MultipleChoice" shuffle="true">`
            );

            const choices = problem.choices || [];
            const correctIndices = problem.correctIndices || [];
            choices.forEach((choice, j) => {
                const correct = correctIndices.includes(j) ? 'true' : 'false';
                parts.push(`      <choice correct="${correct}">${escapeXmlWithFormatting(choice)}</choice>`);
            });

            parts.push(
                `    </choicegroup>`,
                `  </multiplechoiceresponse>`,
                `  <solution>`,
                `    <div class="detailed-solution">`,
                `      <p>Explanation</p>`,
                `      <p>${escapeXmlWithFormatting(problem.explanation)}</p>`,
                `    </div>`,
                `  </solution>`,
                `</problem>`
            );
        } else {
            parts.push(
                `<problem display_name="${escapeXml(displayName)}" max_attempts="${maxAttempts}" markdown="null">`,
                `  <choiceresponse>`,
                `    <label>${escapeXmlWithFormatting(problem.question)}</label>`,
                `    <checkboxgroup>`
            );

            const choices = problem.choices || [];
            const correctIndices = problem.correctIndices || [];
            choices.forEach((choice, j) => {
                const correct = correctIndices.includes(j) ? 'true' : 'false';
                parts.push(`      <choice correct="${correct}">${escapeXmlWithFormatting(choice)}</choice>`);
            });

            parts.push(
                `    </checkboxgroup>`,
                `  </choiceresponse>`,
                `  <solution>`,
                `    <div class="detailed-solution">`,
                `      <p>Explanation</p>`,
                `      <p>${escapeXmlWithFormatting(problem.explanation)}</p>`,
                `    </div>`,
                `  </solution>`,
                `</problem>`
            );
        }

        return parts.join('\n');
    });

    return olxParts.join('\n\n');
}

function updateStatistics(problems, warnings) {
    const stats = {
        total: problems.length,
        multipleChoice: 0,
        checkbox: 0,
        numerical: 0,
        text: 0,
        totalChoices: 0,
        choiceProblems: 0,
        // Count only severity='warn' (not 'info') so the stat card reflects
        // issues that likely matter, not purely informational notes.
        warnings: (warnings || currentWarnings || []).filter(w => w.severity !== 'info').length,
    };

    problems.forEach(p => {
        if (p.answerType === 'numerical') {
            stats.numerical++;
        } else if (p.answerType === 'text') {
            stats.text++;
        } else if (p.isMultipleChoice) {
            stats.multipleChoice++;
            if (p.choices) {
                stats.totalChoices += p.choices.length;
                stats.choiceProblems++;
            }
        } else {
            stats.checkbox++;
            if (p.choices) {
                stats.totalChoices += p.choices.length;
                stats.choiceProblems++;
            }
        }
    });
    
    const avgChoices = stats.choiceProblems > 0 ? (stats.totalChoices / stats.choiceProblems).toFixed(1) : '0';

    // Cache DOM queries for better performance
    const statElements = {
        total: document.querySelector('#stat-total .stat-value'),
        mc: document.querySelector('#stat-mc .stat-value'),
        checkbox: document.querySelector('#stat-checkbox .stat-value'),
        numerical: document.querySelector('#stat-numerical .stat-value'),
        text: document.querySelector('#stat-text .stat-value'),
        choices: document.querySelector('#stat-choices .stat-value'),
        warnings: document.querySelector('#stat-warnings .stat-value'),
        warningCard: document.getElementById('stat-warnings')
    };

    // Add null checks to prevent errors if elements don't exist
    if (statElements.total) statElements.total.textContent = stats.total;
    if (statElements.mc) statElements.mc.textContent = stats.multipleChoice;
    if (statElements.checkbox) statElements.checkbox.textContent = stats.checkbox;
    if (statElements.numerical) statElements.numerical.textContent = stats.numerical;
    if (statElements.text) statElements.text.textContent = stats.text;
    if (statElements.choices) statElements.choices.textContent = avgChoices;
    if (statElements.warnings) statElements.warnings.textContent = stats.warnings;

    if (statElements.warningCard) {
        statElements.warningCard.classList.remove('warning', 'error');
        if (stats.warnings > 0) {
            statElements.warningCard.classList.add('warning');
        }
    }
}

function renderWarningsPanel(warnings, problems) {
    const panel = document.getElementById('warningsPanel');
    const count = document.getElementById('warningsCount');
    const list = document.getElementById('warningsList');
    if (!panel || !count || !list) return;

    if (!warnings || warnings.length === 0) {
        panel.style.display = 'none';
        list.innerHTML = '';
        return;
    }

    panel.style.display = 'block';
    panel.classList.remove('collapsed');
    count.textContent = `${warnings.length} warning${warnings.length === 1 ? '' : 's'}`;

    list.innerHTML = warnings.map(w => {
        const inRange = w.problemIndex >= 0 && problems && w.problemIndex < problems.length;
        const problem = inRange ? problems[w.problemIndex] : null;
        const label = problem
            ? `[${problem.title}]`
            : (w.problemIndex >= 0 ? `[Problem ${w.problemIndex + 1}]` : '');
        const sevClass = w.severity === 'info' ? 'severity-info' : 'severity-warn';
        return `<li class="${sevClass}"><span class="warn-problem">${escapeHtml(label)}</span>${escapeHtml(w.message)}</li>`;
    }).join('');
}

function toggleWarnings() {
    const panel = document.getElementById('warningsPanel');
    if (panel) panel.classList.toggle('collapsed');
}

// Count warnings attached to a given problem index.
function warningsForProblem(problemIndex) {
    return currentWarnings.filter(w => w.problemIndex === problemIndex);
}

function renderPreview(problems) {
    const container = document.getElementById('previewContainer');
    const countBadge = document.getElementById('previewCount');
    const nav = document.getElementById('previewNav');

    if (!container || !countBadge || !nav) {
        console.error('Preview elements not found in DOM');
        return;
    }

    // Clamp currentPreviewIndex to valid range in case problems shrank
    if (problems.length === 0) {
        currentPreviewIndex = 0;
    } else if (currentPreviewIndex >= problems.length) {
        currentPreviewIndex = problems.length - 1;
    } else if (currentPreviewIndex < 0) {
        currentPreviewIndex = 0;
    }

    countBadge.textContent = `${problems.length} Problem${problems.length !== 1 ? 's' : ''}`;

    if (problems.length === 0) {
        container.innerHTML = `
            <div class="preview-empty">
                <div class="preview-empty-icon">📝</div>
                <div>No problems to preview</div>
            </div>
        `;
        nav.style.display = 'none';
        return;
    }

    nav.style.display = 'flex';

    if (showAllMode) {
        renderAllProblems(problems);
    } else {
        renderSingleProblem(problems, currentPreviewIndex);
    }

    updateNavInfo();
}

function renderAllProblems(problems) {
    const container = document.getElementById('previewContainer');
    if (!container) {
        console.error('Preview container not found');
        return;
    }
    container.innerHTML = problems.map((p, i) => renderProblemHTML(p, i)).join('');
    attachEditListeners();

    // Re-render MathJax equations
    if (window.MathJax && window.MathJax.typesetPromise) {
        window.MathJax.typesetPromise([container]).catch((err) => {
            console.error('MathJax rendering error:', err);
        });
    }
}

function renderSingleProblem(problems, index) {
    const container = document.getElementById('previewContainer');
    if (!container) {
        console.error('Preview container not found');
        return;
    }
    if (!problems[index]) {
        container.innerHTML = '<div class="preview-empty"><div>Problem not found</div></div>';
        return;
    }
    container.innerHTML = renderProblemHTML(problems[index], index);
    attachEditListeners();

    // Re-render MathJax equations
    if (window.MathJax && window.MathJax.typesetPromise) {
        window.MathJax.typesetPromise([container]).catch((err) => {
            console.error('MathJax rendering error:', err);
        });
    }
}

function renderProblemHTML(problem, index) {
    let typeClass = 'multiple-choice';
    let typeName = 'Single Choice';

    if (problem.answerType === 'numerical') {
        typeClass = 'numerical';
        typeName = 'Numerical';
    } else if (problem.answerType === 'text') {
        typeClass = 'text';
        typeName = 'Text Input';
    } else if (!problem.isMultipleChoice) {
        typeClass = 'checkbox';
        typeName = 'Multi-Select';
    }

    let choicesHTML = '';

    if (problem.answerType === 'numerical' || problem.answerType === 'text') {
        choicesHTML = `
            <div class="preview-input-field">Enter your answer...</div>
            <div class="preview-answer-hint">✓ Correct answer:
                <span class="editable" contenteditable="true" data-problem="${index}" data-field="answer">${escapeHtmlWithFormatting(problem.answer || '')}</span>
            </div>
        `;
    } else {
        const indicatorClass = problem.isMultipleChoice ? '' : 'checkbox';
        const choices = problem.choices || [];
        const correctIndices = problem.correctIndices || [];
        choicesHTML = `
            <ul class="preview-choices">
                ${choices.map((choice, i) => `
                    <li class="preview-choice ${correctIndices.includes(i) ? 'correct' : ''}">
                        <div class="preview-choice-indicator ${indicatorClass}"></div>
                        <span class="preview-choice-text editable" contenteditable="true" data-problem="${index}" data-field="choice" data-choice="${i}">${escapeHtmlWithFormatting(choice)}</span>
                    </li>
                `).join('')}
            </ul>
        `;
    }

    const problemWarnings = warningsForProblem(index);
    // Use " | " as a delimiter rather than "\n" - the latter is whitespace-
    // collapsed or rendered inconsistently by tooltip implementations, and
    // "\n" embedded in an HTML attribute source is awkward to reason about.
    const warnBadge = problemWarnings.length > 0
        ? `<span class="preview-warning-badge" data-index="${index}" title="${escapeHtml(problemWarnings.map(w => w.message).join(' | '))}">⚠ ${problemWarnings.length}</span>`
        : `<span class="preview-warning-badge" data-index="${index}" style="display:none;"></span>`;

    return `
        <div class="preview-problem" data-index="${index}">
            <div class="preview-problem-header">
                <span class="preview-problem-title">${escapeHtmlWithFormatting(problem.title || '')}${warnBadge}</span>
                <span class="preview-problem-type ${typeClass}">${typeName}</span>
            </div>
            <div class="preview-question editable" contenteditable="true" data-problem="${index}" data-field="question">${escapeHtmlWithFormatting(problem.question || '')}</div>
            ${choicesHTML}
            <div class="preview-explanation">
                <div class="preview-explanation-label">Explanation</div>
                <div class="preview-explanation-text editable" contenteditable="true" data-problem="${index}" data-field="explanation">${escapeHtmlWithFormatting(problem.explanation || '')}</div>
            </div>
        </div>
    `;
}

function attachEditListeners() {
    // Use event delegation to avoid memory leaks from duplicate listeners
    if (editListenersInitialized) return;

    const container = document.getElementById('previewContainer');
    if (!container) {
        console.error('Preview container not found for event listeners');
        return;
    }

    // Use event delegation on the parent container
    container.addEventListener('input', function(e) {
        if (e.target.classList.contains('editable')) {
            handleEdit(e);
        }
    });

    container.addEventListener('focus', function(e) {
        if (e.target.classList.contains('editable')) {
            handleFocus(e);
        }
    }, true); // Use capture phase for focus

    container.addEventListener('blur', function(e) {
        if (e.target.classList.contains('editable')) {
            handleBlur(e);
        }
    }, true); // Use capture phase for blur

    container.addEventListener('keydown', function(e) {
        if (e.target.classList.contains('editable')) {
            handleKeydown(e);
        }
    });

    editListenersInitialized = true;
}

// Debounce timer for the expensive OLX regeneration only. The per-keystroke
// state update (sanitize + assign) runs immediately so that rapidly moving
// focus between fields does not drop edits: a prior pending timer would
// have been cleared, losing any edit that was only captured in its deferred
// callback.
let updateOlxDebounce = null;

function handleEdit(e) {
    const el = e.target;
    const problemIndex = parseInt(el.dataset.problem, 10);
    const field = el.dataset.field;
    const choiceIndex = el.dataset.choice !== undefined ? parseInt(el.dataset.choice, 10) : null;

    if (isNaN(problemIndex) || !currentProblems[problemIndex]) return;
    if (choiceIndex !== null && isNaN(choiceIndex)) return;

    // Apply state immediately. sanitizeHtml walks only the single edited
    // element's subtree so it's cheap per keystroke.
    const content = field === 'answer'
        ? el.textContent               // answers are plain text
        : sanitizeHtml(el.innerHTML);

    if (field === 'question') {
        currentProblems[problemIndex].question = content;
    } else if (field === 'explanation') {
        currentProblems[problemIndex].explanation = content;
    } else if (field === 'choice' && choiceIndex !== null) {
        if (currentProblems[problemIndex].choices &&
            currentProblems[problemIndex].choices[choiceIndex] !== undefined) {
            currentProblems[problemIndex].choices[choiceIndex] = content;
        }
    } else if (field === 'answer') {
        currentProblems[problemIndex].answer = content;
    }

    // Coalesce the expensive rebuild across rapid keystrokes.
    clearTimeout(updateOlxDebounce);
    updateOlxDebounce = setTimeout(() => {
        updateOLXOutput();
    }, 150);
}

function handleFocus(e) {
    const indicator = document.getElementById('editIndicator');
    if (indicator) indicator.style.display = 'inline-flex';
}

function handleBlur(e) {
    // Defer until after the focus transfer completes, then check whether
    // focus landed on another editable. Using relatedTarget alone misses
    // focus moves triggered via mousedown on a non-editable.
    requestAnimationFrame(() => {
        const active = document.activeElement;
        if (!active || !active.classList || !active.classList.contains('editable')) {
            const indicator = document.getElementById('editIndicator');
            if (indicator) indicator.style.display = 'none';
        }
    });
}

function handleKeydown(e) {
    if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
            case 'b':
                e.preventDefault();
                formatText('bold');
                break;
            case 'i':
                e.preventDefault();
                formatText('italic');
                break;
            case 'u':
                e.preventDefault();
                formatText('underline');
                break;
            case 'k':
                e.preventDefault();
                showLinkDialog();
                break;
            case '`':
                e.preventDefault();
                wrapInlineCode();
                break;
        }
    }
}

function formatText(command) {
    document.execCommand(command, false, null);
    updateAfterFormat();
}

function wrapInlineCode() {
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const selectedText = range.toString();
        const code = document.createElement('code');
        code.textContent = selectedText || 'code';
        range.deleteContents();
        range.insertNode(code);
        
        // Move cursor after the code element
        range.setStartAfter(code);
        range.setEndAfter(code);
        selection.removeAllRanges();
        selection.addRange(range);
    }
    updateAfterFormat();
}

function showCodeDialog() {
    const codeContent = document.getElementById('codeContent');
    const codeType = document.getElementById('codeType');
    const codeLanguage = document.getElementById('codeLanguage');
    const codeDialog = document.getElementById('codeDialog');

    if (!codeContent || !codeType || !codeLanguage || !codeDialog) {
        console.error('Code dialog elements not found');
        return;
    }

    // Save current selection
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
        savedSelection = selection.getRangeAt(0).cloneRange();
        const selectedText = selection.toString();
        codeContent.value = selectedText;
    } else {
        codeContent.value = '';
    }
    codeType.value = 'inline';
    codeLanguage.value = '';
    codeDialog.classList.add('visible');
    codeContent.focus();
}

function closeCodeDialog() {
    const codeDialog = document.getElementById('codeDialog');
    if (codeDialog) {
        codeDialog.classList.remove('visible');
    }
    savedSelection = null;
}

function insertCodeBlock() {
    const codeType = document.getElementById('codeType').value;
    const language = document.getElementById('codeLanguage').value.trim();
    const content = document.getElementById('codeContent').value;
    
    if (!content) {
        alert('Please enter some code');
        return;
    }
    
    if (savedSelection) {
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(savedSelection);
        
        let codeElement;
        
        if (codeType === 'block') {
            // Create a pre > code structure for block code
            const pre = document.createElement('pre');
            codeElement = document.createElement('code');
            if (language) {
                codeElement.className = `language-${language}`;
                codeElement.dataset.language = language;
            }
            codeElement.textContent = content;
            pre.appendChild(codeElement);
            codeElement = pre;
        } else {
            // Inline code
            codeElement = document.createElement('code');
            codeElement.textContent = content;
        }
        
        savedSelection.deleteContents();
        savedSelection.insertNode(codeElement);
        
        // Move cursor after the code element
        savedSelection.setStartAfter(codeElement);
        savedSelection.setEndAfter(codeElement);
        selection.removeAllRanges();
        selection.addRange(savedSelection);
    }
    
    closeCodeDialog();
    updateAfterFormat();
}

function showLatexDialog() {
    const latexContent = document.getElementById('latexContent');
    const latexType = document.getElementById('latexType');
    const latexDialog = document.getElementById('latexDialog');

    if (!latexContent || !latexType || !latexDialog) {
        console.error('LaTeX dialog elements not found');
        return;
    }

    // Save current selection
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
        savedSelection = selection.getRangeAt(0).cloneRange();
        const selectedText = selection.toString();
        latexContent.value = selectedText;
    } else {
        latexContent.value = '';
    }
    latexType.value = 'inline';
    latexDialog.classList.add('visible');
    latexContent.focus();
    updateLatexPreview();
}

function closeLatexDialog() {
    const latexDialog = document.getElementById('latexDialog');
    if (latexDialog) {
        latexDialog.classList.remove('visible');
    }
    savedSelection = null;
}

function updateLatexPreview() {
    const contentEl = document.getElementById('latexContent');
    const typeEl = document.getElementById('latexType');
    const preview = document.getElementById('latexPreview');

    if (!contentEl || !typeEl || !preview) {
        console.error('LaTeX preview elements not found');
        return;
    }

    const content = contentEl.value;
    const type = typeEl.value;

    if (!content) {
        preview.innerHTML = '<em style="color: var(--text-muted);">Enter LaTeX code to see preview...</em>';
        return;
    }

    let formatted;
    switch(type) {
        case 'inline':
            formatted = `\\(${content}\\)`;
            break;
        case 'inline-dollar':
            formatted = `$${content}$`;
            break;
        case 'display':
            formatted = `\\[${content}\\]`;
            break;
        case 'display-dollar':
            formatted = `$$${content}$$`;
            break;
    }

    preview.textContent = formatted;

    // Trigger MathJax to render
    if (window.MathJax && window.MathJax.typesetPromise) {
        window.MathJax.typesetPromise([preview]).catch((err) => {
            preview.innerHTML = '<span style="color: #ff5555;">Error rendering LaTeX</span>';
            console.error('MathJax error:', err);
        });
    }
}

function validateLatexBalance(content) {
    // Check for balanced delimiters (only check regular braces, brackets, parentheses)
    // Note: \{, \}, \[, \], \(, \) are LaTeX escape sequences and shouldn't be counted
    const checks = [
        { open: '{', close: '}', name: 'curly braces' },
        { open: '[', close: ']', name: 'square brackets' },
        { open: '(', close: ')', name: 'parentheses' }
    ];

    for (const {open, close, name} of checks) {
        // Count only non-escaped delimiters
        // Use negative lookbehind to exclude \{, \[, \( etc.
        try {
            const openRegex = new RegExp(`(?<!\\\\)\\${open}`, 'g');
            const closeRegex = new RegExp(`(?<!\\\\)\\${close}`, 'g');
            const openCount = (content.match(openRegex) || []).length;
            const closeCount = (content.match(closeRegex) || []).length;

            if (openCount !== closeCount) {
                return { valid: false, message: `Unbalanced ${name}: ${openCount} opening, ${closeCount} closing` };
            }
        } catch (e) {
            // Fallback for browsers that don't support lookbehind
            const openCount = (content.match(new RegExp(`\\${open}`, 'g')) || []).length;
            const closeCount = (content.match(new RegExp(`\\${close}`, 'g')) || []).length;

            if (openCount !== closeCount) {
                return { valid: false, message: `Unbalanced ${name}` };
            }
        }
    }

    return { valid: true };
}

function insertLatex() {
    const type = document.getElementById('latexType').value;
    const content = document.getElementById('latexContent').value;

    if (!content) {
        alert('Please enter LaTeX code');
        return;
    }

    // Validate balanced delimiters
    const validation = validateLatexBalance(content);
    if (!validation.valid) {
        alert(`LaTeX validation warning: ${validation.message}\nDo you want to insert anyway?`);
        // Continue anyway - user might know what they're doing
    }

    let formatted;
    switch(type) {
        case 'inline':
            formatted = `\\(${content}\\)`;
            break;
        case 'inline-dollar':
            formatted = `$${content}$`;
            break;
        case 'display':
            formatted = `\\[${content}\\]`;
            break;
        case 'display-dollar':
            formatted = `$$${content}$$`;
            break;
    }

    if (savedSelection) {
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(savedSelection);

        const textNode = document.createTextNode(formatted);
        savedSelection.deleteContents();
        savedSelection.insertNode(textNode);

        // Move cursor after the inserted text
        savedSelection.setStartAfter(textNode);
        savedSelection.setEndAfter(textNode);
        selection.removeAllRanges();
        selection.addRange(savedSelection);
    }

    closeLatexDialog();
    updateAfterFormat();

    // Re-render MathJax in the preview
    if (window.MathJax && window.MathJax.typesetPromise) {
        setTimeout(() => {
            const previewContainer = document.getElementById('previewContainer');
            if (previewContainer) {
                window.MathJax.typesetPromise([previewContainer]).catch((err) => {
                    console.error('MathJax rendering error:', err);
                });
            }
        }, 100);
    }
}

function showLinkDialog() {
    const linkText = document.getElementById('linkText');
    const linkUrl = document.getElementById('linkUrl');
    const linkDialog = document.getElementById('linkDialog');

    if (!linkText || !linkUrl || !linkDialog) {
        console.error('Link dialog elements not found');
        return;
    }

    // Save current selection
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
        savedSelection = selection.getRangeAt(0).cloneRange();
        linkText.value = selection.toString();
    }
    linkUrl.value = '';
    linkDialog.classList.add('visible');
    linkUrl.focus();
}

function closeLinkDialog() {
    const linkDialog = document.getElementById('linkDialog');
    if (linkDialog) {
        linkDialog.classList.remove('visible');
    }
    savedSelection = null;
}

function insertLink() {
    const url = document.getElementById('linkUrl').value;
    const text = document.getElementById('linkText').value;
    const openInNewTab = document.getElementById('linkTarget').checked;
    
    if (!url) {
        alert('Please enter a URL');
        return;
    }
    
    if (savedSelection) {
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(savedSelection);
        
        const link = document.createElement('a');
        link.href = url;
        if (openInNewTab) {
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
        }
        link.textContent = text || url;
        
        savedSelection.deleteContents();
        savedSelection.insertNode(link);
        
        // Move cursor after link
        savedSelection.setStartAfter(link);
        savedSelection.setEndAfter(link);
        selection.removeAllRanges();
        selection.addRange(savedSelection);
    }
    
    closeLinkDialog();
    updateAfterFormat();
}

function removeLink() {
    document.execCommand('unlink', false, null);
    updateAfterFormat();
}

function updateAfterFormat() {
    // Trigger input event on focused editable
    const focused = document.querySelector('.editable:focus');
    if (focused) {
        focused.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

function updateOLXOutput() {
    const output = document.getElementById('output');
    if (!output) {
        console.error('Output element not found');
        return;
    }
    const olx = generateOLX(currentProblems);
    output.textContent = olx;
    // Refresh warnings + stats now that currentProblems may have changed.
    revalidateWarnings();
    updateStatistics(currentProblems, currentWarnings);
}

// Re-run validation against the in-memory problems and refresh the UI that
// depends on it (panel + per-problem badges). Parser warnings captured at
// initial parse time are preserved since they describe the raw source text
// and don't become less true after an edit. We distinguish the two via a
// `source` field set when the warning is created.
function revalidateWarnings() {
    const parserWarnings = currentWarnings.filter(w => w.source === 'parser');
    const validationWarnings = [];
    validateProblems(currentProblems, validationWarnings);
    currentWarnings = [...parserWarnings, ...validationWarnings];
    renderWarningsPanel(currentWarnings, currentProblems);
    refreshProblemWarningBadges();
}

// Update each per-problem badge in place so the user's in-progress edit
// does not lose focus. Badges are always rendered (possibly hidden) so we
// can find them by data-index.
function refreshProblemWarningBadges() {
    const container = document.getElementById('previewContainer');
    if (!container) return;
    container.querySelectorAll('.preview-warning-badge').forEach(el => {
        const idx = parseInt(el.dataset.index, 10);
        if (isNaN(idx)) return;
        const ws = warningsForProblem(idx);
        if (ws.length === 0) {
            el.style.display = 'none';
            el.textContent = '';
            el.removeAttribute('title');
        } else {
            el.style.display = '';
            el.textContent = `⚠ ${ws.length}`;
            el.setAttribute('title', ws.map(w => w.message).join(' | '));
        }
    });
}

function updateNavInfo() {
    const navInfo = document.getElementById('previewNavInfo');
    if (!navInfo) {
        console.error('Preview nav info element not found');
        return;
    }
    if (showAllMode) {
        navInfo.textContent = `Showing all ${currentProblems.length}`;
    } else {
        navInfo.textContent = `${currentPreviewIndex + 1} of ${currentProblems.length}`;
    }
}

function prevProblem() {
    if (currentProblems.length === 0) return;
    showAllMode = false;
    currentPreviewIndex = (currentPreviewIndex - 1 + currentProblems.length) % currentProblems.length;
    renderSingleProblem(currentProblems, currentPreviewIndex);
    updateNavInfo();
}

function nextProblem() {
    if (currentProblems.length === 0) return;
    showAllMode = false;
    currentPreviewIndex = (currentPreviewIndex + 1) % currentProblems.length;
    renderSingleProblem(currentProblems, currentPreviewIndex);
    updateNavInfo();
}

function showAllProblems() {
    showAllMode = true;
    renderAllProblems(currentProblems);
    updateNavInfo();
}

function togglePreview() {
    previewEnabled = !previewEnabled;
    const toggle = document.getElementById('previewToggle');
    const grid = document.getElementById('mainGrid');
    const panel = document.getElementById('previewPanel');

    if (!toggle || !grid || !panel) {
        console.error('Preview toggle elements not found');
        return;
    }

    toggle.classList.toggle('active', previewEnabled);

    if (previewEnabled) {
        grid.classList.add('three-col');
        panel.style.display = 'flex';
    } else {
        grid.classList.remove('three-col');
        panel.style.display = 'none';
    }
}

function convertToOLX() {
    const input = document.getElementById('input').value;
    const output = document.getElementById('output');
    
    if (!input.trim()) {
        showStatus('Please enter problem text to convert', 'error');
        return;
    }
    
    try {
        const result = parseProblems(input);
        const problems = result.problems;
        
        if (problems.length === 0) {
            showStatus('No problems found. Please check your input format.', 'error');
            return;
        }
        
        currentProblems = problems;
        currentLibraryMeta = {
            libraryOrg: result.libraryOrg,
            libraryName: result.libraryName,
            libraryId: result.libraryId,
            displayNameLabel: result.displayNameLabel,
        };
        currentWarnings = result.warnings || [];
        currentPreviewIndex = 0;
        showAllMode = true;

        const olx = generateOLX(problems);
        output.textContent = olx;

        renderWarningsPanel(currentWarnings, problems);
        updateStatistics(problems, currentWarnings);

        if (previewEnabled) {
            renderPreview(problems);
        }

        const labelMsg = result.displayNameLabel ? ` (using label: "${result.displayNameLabel}")` : '';
        const warnMsg = currentWarnings.length > 0 ? ` • ${currentWarnings.length} warning(s)` : '';
        showStatus(`Successfully converted ${problems.length} problem(s)${labelMsg}${warnMsg} - Click text in preview to edit`, 'success');
    } catch (error) {
        showStatus(`Error: ${error.message}`, 'error');
        console.error(error);
    }
}

function copyOutput() {
    const output = document.getElementById('output');
    const text = output.textContent;

    if (!text || text === 'OLX output will appear here...') {
        showStatus('No output to copy', 'error');
        return;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            showStatus('Copied to clipboard!', 'success');
        }).catch(() => {
            copyFallback(text);
        });
    } else {
        copyFallback(text);
    }
}

function copyFallback(text) {
    // Legacy fallback for insecure contexts / older browsers
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
        ok = document.execCommand('copy');
    } catch (e) {
        ok = false;
    }
    document.body.removeChild(ta);
    showStatus(ok ? 'Copied to clipboard!' : 'Failed to copy - copy manually', ok ? 'success' : 'error');
}

let downloadInProgress = false;

function downloadOutput() {
    if (downloadInProgress) return;
    const output = document.getElementById('output');
    const text = output.textContent;

    if (!text || text === 'OLX output will appear here...') {
        showStatus('No output to download', 'error');
        return;
    }

    downloadInProgress = true;
    let url;
    try {
        const blob = new Blob([text], { type: 'text/xml' });
        url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'problems.xml';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showStatus('Downloaded problems.xml', 'success');
    } catch (err) {
        showStatus('Error creating download: ' + err.message, 'error');
        console.error(err);
    } finally {
        if (url) URL.revokeObjectURL(url);
        setTimeout(() => { downloadInProgress = false; }, 500);
    }
}

function generateUUID() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID().replace(/-/g, '');
    }
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    }
    // Last-resort fallback (dev only) - Math.random is not crypto safe
    return 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'.replace(/x/g, function() {
        return Math.floor(Math.random() * 16).toString(16);
    });
}

function generateSingleProblemXML(problem, index, urlName) {
    const displayName = problem.title;
    const maxAttempts = getMaxAttempts(problem);
    const urlNameAttr = urlName ? ` url_name="${escapeXml(urlName)}"` : '';
    const parts = [`<problem${urlNameAttr} display_name="${escapeXml(displayName)}" max_attempts="${maxAttempts}" markdown="null">`];

    if (problem.answerType === 'numerical') {
        parts.push(
            `  <numericalresponse answer="${escapeXml(problem.answer || '')}">`,
            `    <label>${escapeXmlWithFormatting(problem.question)}</label>`,
            `    <textline/>`,
            `  </numericalresponse>`
        );
    } else if (problem.answerType === 'text') {
        parts.push(
            `  <stringresponse answer="${escapeXml(problem.answer || '')}" type="ci">`,
            `    <label>${escapeXmlWithFormatting(problem.question)}</label>`,
            `    <textline size="40"/>`,
            `  </stringresponse>`
        );
    } else if (problem.isMultipleChoice) {
        parts.push(
            `  <multiplechoiceresponse>`,
            `    <label>${escapeXmlWithFormatting(problem.question)}</label>`,
            `    <choicegroup type="MultipleChoice" shuffle="true">`
        );

        const choices = problem.choices || [];
        const correctIndices = problem.correctIndices || [];
        choices.forEach((choice, j) => {
            const correct = correctIndices.includes(j) ? 'true' : 'false';
            parts.push(`      <choice correct="${correct}">${escapeXmlWithFormatting(choice)}</choice>`);
        });

        parts.push(
            `    </choicegroup>`,
            `  </multiplechoiceresponse>`
        );
    } else {
        parts.push(
            `  <choiceresponse>`,
            `    <label>${escapeXmlWithFormatting(problem.question)}</label>`,
            `    <checkboxgroup>`
        );

        const choices = problem.choices || [];
        const correctIndices = problem.correctIndices || [];
        choices.forEach((choice, j) => {
            const correct = correctIndices.includes(j) ? 'true' : 'false';
            parts.push(`      <choice correct="${correct}">${escapeXmlWithFormatting(choice)}</choice>`);
        });

        parts.push(
            `    </checkboxgroup>`,
            `  </choiceresponse>`
        );
    }

    parts.push(
        `  <solution>`,
        `    <div class="detailed-solution">`,
        `      <p>Explanation</p>`,
        `      <p>${escapeXmlWithFormatting(problem.explanation)}</p>`,
        `    </div>`,
        `  </solution>`,
        `</problem>`
    );

    return parts.join('\n');
}

let libraryDownloadInProgress = false;

async function downloadLibrary() {
    if (libraryDownloadInProgress) return;
    if (currentProblems.length === 0) {
        showStatus('No problems to export. Convert problems first.', 'error');
        return;
    }

    libraryDownloadInProgress = true;
    let url;
    try {
        // Use the metadata captured at parse time so that edits, text-area
        // changes, or a cleared input cannot desynchronize the library
        // header from the currentProblems being exported.
        const meta = currentLibraryMeta || {
            libraryOrg: 'MITxT',
            libraryName: 'Problem Library',
            libraryId: 'CustomLibrary',
        };

        const problemXMLs = currentProblems.map((problem, index) => {
            const problemId = `problem_${generateUUID()}`;
            return {
                id: problemId,
                filename: `${problemId}.xml`,
                content: generateSingleProblemXML(problem, index, problemId)
            };
        });

        let libraryXML = `<library org="${escapeXml(meta.libraryOrg)}" library="${escapeXml(meta.libraryId)}" display_name="${escapeXml(meta.libraryName)}">\n`;
        for (const pf of problemXMLs) {
            libraryXML += `  <problem url_name="${pf.id}"/>\n`;
        }
        libraryXML += `</library>`;

        const zip = new JSZip();
        const safeLibraryId = makeSafeFilename(meta.libraryId);
        const library = zip.folder(safeLibraryId);
        const problemFolder = library.folder('problem');
        const policiesFolder = library.folder('policies');
        
        for (const pf of problemXMLs) {
            problemFolder.file(pf.filename, pf.content);
        }
        
        library.file('library.xml', libraryXML);
        policiesFolder.file('assets.json', '{}');
        
        const content = await zip.generateAsync({ 
            type: 'blob',
            compression: "DEFLATE",
            compressionOptions: { level: 9 }
        });
        
        url = URL.createObjectURL(content);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${safeLibraryId}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        showStatus(`Downloaded ${safeLibraryId}.zip with ${currentProblems.length} problems (with edits)`, 'success');
    } catch (error) {
        showStatus(`Error creating library: ${error.message}`, 'error');
        console.error(error);
    } finally {
        if (url) URL.revokeObjectURL(url);
        setTimeout(() => { libraryDownloadInProgress = false; }, 500);
    }
}

function clearAll() {
    document.getElementById('input').value = '';
    document.getElementById('output').textContent = 'OLX output will appear here...';
    document.getElementById('status').style.display = 'none';
    const wp = document.getElementById('warningsPanel');
    if (wp) wp.style.display = 'none';
    currentProblems = [];
    currentLibraryMeta = null;
    currentWarnings = [];
    currentPreviewIndex = 0;
    showAllMode = true;

    document.querySelectorAll('.stat-value').forEach(el => el.textContent = '0');
    document.getElementById('stat-warnings').classList.remove('warning', 'error');

    renderPreview([]);
}

function loadSample() {
    const sample = `Module 3 - Assignment 1 - Part 1 - Question 1: UAI0_A01_P01_Q01

Label: Part 1 Question 1

Original: What type of data is best visualized with a bar chart?
Continuous time series data
Relationships between variables
Discrete categorical comparisons (correct)
Cumulative totals

Explanation: Bar charts are ideal for comparing discrete categories side by side, making it easy to see differences between groups.

1. Which of the following are data visualization tools? (Select all that apply)
Tableau (correct)
Microsoft Word
Python matplotlib (correct)
Adobe Photoshop
Power BI (correct)

Explanation: Tableau, matplotlib, and Power BI are all specialized data visualization tools designed for creating charts and graphs.

2. Which scenario is best suited for a bar chart?
Comparing sales across product categories (correct)
Tracking stock prices throughout the day
Examining the relationship between two numerical variables
Plotting a sine wave

Explanation: Product categories represent distinct groups that can be effectively compared using bars of different heights.

3. What is 2 + 2?
Answer: 4

Explanation: Basic arithmetic shows that two plus two equals four.`;
    
    document.getElementById('input').value = sample;
    showStatus('Sample data loaded - click Convert to see editable preview', 'success');
}

function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    if (file.name.endsWith('.docx')) {
        const reader = new FileReader();
        
        reader.onload = function(e) {
            const arrayBuffer = e.target.result;
            
            mammoth.convertToHtml({arrayBuffer: arrayBuffer}, {
                styleMap: [
                    "p[style-name='Heading 1'] => h1:fresh",
                    "p[style-name='Heading 2'] => h2:fresh",
                    "b => strong",
                    "i => em",
                    "u => u"
                ]
            })
                .then(function(result) {
                    const html = result.value;
                    // Parse via DOMParser so images/scripts aren't fetched/executed
                    const parsedDoc = new DOMParser().parseFromString(
                        `<!doctype html><body>${html}</body>`, 'text/html');
                    const tempDiv = parsedDoc.body;
                    sanitizeNode(tempDiv);
                    
                    let text = '';
                    const processNode = (node) => {
                        if (node.nodeType === Node.TEXT_NODE) {
                            return node.textContent;
                        }
                        
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            const tag = node.tagName.toLowerCase();
                            let content = '';
                            
                            for (let child of node.childNodes) {
                                content += processNode(child);
                            }
                            
                            switch(tag) {
                                case 'strong':
                                case 'b':
                                    return `<strong>${content}</strong>`;
                                case 'em':
                                case 'i':
                                    return `<em>${content}</em>`;
                                case 'u':
                                    return `<u>${content}</u>`;
                                case 'sup':
                                    return `<sup>${content}</sup>`;
                                case 'sub':
                                    return `<sub>${content}</sub>`;
                                case 'code':
                                    return `<code>${content}</code>`;
                                case 'p':
                                case 'li':
                                    return content + '\n';
                                case 'br':
                                    return '\n';
                                default:
                                    return content;
                            }
                        }
                        return '';
                    };
                    
                    const paragraphs = tempDiv.querySelectorAll('p, li');
                    if (paragraphs.length > 0) {
                        paragraphs.forEach(p => {
                            const processed = processNode(p);
                            if (processed.trim()) {
                                text += processed;
                            }
                        });
                    } else {
                        text = processNode(tempDiv);
                    }
                    
                    document.getElementById('input').value = text;
                    showStatus(`Loaded ${file.name} (converted from Word with formatting)`, 'success');
                })
                .catch(function(err) {
                    console.error('Error reading Word document:', err);
                    showStatus('Error reading Word document', 'error');
                });
        };
        
        reader.onerror = function() {
            showStatus('Error reading file', 'error');
        };
        
        reader.readAsArrayBuffer(file);
    } else {
        const reader = new FileReader();
        
        reader.onload = function(e) {
            const text = e.target.result;
            document.getElementById('input').value = text;
            showStatus(`Loaded ${file.name}`, 'success');
        };
        
        reader.onerror = function() {
            showStatus('Error reading file', 'error');
        };
        
        reader.readAsText(file);
    }
}

function showStatus(message, type) {
    const status = document.getElementById('status');
    if (!status) {
        console.error('Status element not found');
        return;
    }
    status.textContent = message;
    status.className = `status ${type}`;
    status.style.display = 'block';

    setTimeout(() => {
        status.style.display = 'none';
    }, 4000);
}

// Handle link dialog with Enter key
const linkUrl = document.getElementById('linkUrl');
if (linkUrl) {
    linkUrl.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            insertLink();
        } else if (e.key === 'Escape') {
            closeLinkDialog();
        }
    });
}

const linkText = document.getElementById('linkText');
if (linkText) {
    linkText.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            insertLink();
        } else if (e.key === 'Escape') {
            closeLinkDialog();
        }
    });
}

// Close dialog when clicking overlay
const linkDialog = document.getElementById('linkDialog');
if (linkDialog) {
    linkDialog.addEventListener('click', function(e) {
        if (e.target === this) {
            closeLinkDialog();
        }
    });
}

// Code dialog event listeners
const codeContent = document.getElementById('codeContent');
if (codeContent) {
    codeContent.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeCodeDialog();
        }
        // Allow Tab for indentation in code
        if (e.key === 'Tab') {
            e.preventDefault();
            const start = this.selectionStart;
            const end = this.selectionEnd;
            this.value = this.value.substring(0, start) + '    ' + this.value.substring(end);
            this.selectionStart = this.selectionEnd = start + 4;
        }
    });
}

const codeDialog = document.getElementById('codeDialog');
if (codeDialog) {
    codeDialog.addEventListener('click', function(e) {
        if (e.target === this) {
            closeCodeDialog();
        }
    });
}

// LaTeX dialog event listeners
const latexContent = document.getElementById('latexContent');
const latexType = document.getElementById('latexType');
const latexDialog = document.getElementById('latexDialog');

if (latexContent) {
    latexContent.addEventListener('input', updateLatexPreview);

    latexContent.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeLatexDialog();
        }
        // Allow Tab for indentation
        if (e.key === 'Tab') {
            e.preventDefault();
            const start = this.selectionStart;
            const end = this.selectionEnd;
            this.value = this.value.substring(0, start) + '    ' + this.value.substring(end);
            this.selectionStart = this.selectionEnd = start + 4;
        }
    });
}

if (latexType) {
    latexType.addEventListener('change', updateLatexPreview);
}

if (latexDialog) {
    latexDialog.addEventListener('click', function(e) {
        if (e.target === this) {
            closeLatexDialog();
        }
    });
}

// Global Escape handler closes whichever dialog is open so the
// behavior is consistent regardless of what has focus.
document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape') return;
    const dialogs = [
        { el: document.getElementById('linkDialog'), close: closeLinkDialog },
        { el: document.getElementById('codeDialog'), close: closeCodeDialog },
        { el: document.getElementById('latexDialog'), close: closeLatexDialog }
    ];
    for (const d of dialogs) {
        if (d.el && d.el.classList.contains('visible')) {
            d.close();
            e.preventDefault();
            return;
        }
    }
});
