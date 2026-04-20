// End-to-end regression test against real .docx assignments. Point
// ASSIGNMENTS_DIR at an unzipped "Final in Studio" bundle to run it.
// Skipped silently when the directory is not present.

import { existsSync, readdirSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { loadConverterApi, docxToText, TestRunner, assert } from './harness.mjs';

const ASSIGNMENTS_DIR = process.env.ASSIGNMENTS_DIR
    || '/tmp/assignments/Final in Studio';

const t = new TestRunner('assignments');

if (!existsSync(ASSIGNMENTS_DIR)) {
    console.log(`\x1b[33mSKIP\x1b[0m assignments: ${ASSIGNMENTS_DIR} not found (set ASSIGNMENTS_DIR to run)`);
} else {
    const api = loadConverterApi();

    const files = [];
    (function walk(dir) {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.docx') && !entry.name.startsWith('~')) {
                // One outlier file is author-format-specific; skip per prior call
                if (entry.name === 'Module 8 Assignment 1.docx' && !full.includes('NEW')) continue;
                files.push(full);
            }
        }
    })(ASSIGNMENTS_DIR);

    // Budget based on the v4.3 stable baseline (182 "soft" issues across 39
    // assignments). Treat a sharp regression as a test failure; small drift
    // is expected as parsing improves.
    const ISSUE_BUDGET = 200;

    await t.caseAsync(`${files.length} assignments parse without throwing`, async () => {
        for (const f of files) {
            const text = await docxToText(f);
            const result = api.parseProblems(text);
            assert(Array.isArray(result.problems),
                `${basename(f)}: parseProblems did not return problems array`);
        }
    });

    await t.caseAsync('aggregate issue count stays within budget', async () => {
        let total = 0;
        const bad = [];
        for (const f of files) {
            const text = await docxToText(f);
            const result = api.parseProblems(text);
            const issues = countIssues(result.problems);
            if (issues > 60) bad.push(`${basename(f)}: ${issues}`);
            total += issues;
        }
        assert(total <= ISSUE_BUDGET,
            `aggregate issues ${total} exceeds budget ${ISSUE_BUDGET}; ` +
            `worst offenders: ${bad.slice(0, 5).join(', ')}`);
    });
}

function countIssues(problems) {
    let n = 0;
    for (const p of problems) {
        const hasChoices = p.choices && p.choices.length > 0;
        const hasAnswer = p.answer !== undefined && p.answer !== '';
        if (!p.question || !p.question.trim()) n++;
        if (!hasChoices && !hasAnswer) n++;
        if (hasChoices && (!p.correctIndices || p.correctIndices.length === 0) && !hasAnswer) n++;
        if (hasChoices && p.choices.length < 2) n++;
        if ((p.explanation || '').trim() === 'Add your explanation here') n++;
        if (hasChoices) {
            for (const c of p.choices) {
                if ((c || '').length > 400) n++;
            }
        }
    }
    return n;
}

export default t;
