// The outage guard exists because an exhausted upstream wallet fails every
// render identically, and the board filled with eighty copies of one error.
// These lock in the two decisions that make it work: which messages count as
// "out of credit", and that such a message is NEVER retried as a blip.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../lib/renderJobs.js', import.meta.url), 'utf8');

const extract = (name) => {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start > -1, `${name} not found in lib/renderJobs.js`);
    const open = source.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < source.length; i += 1) {
        if (source[i] === '{') depth += 1;
        if (source[i] === '}') { depth -= 1; if (depth === 0) return source.slice(start, i + 1); }
    }
    throw new Error(`could not read ${name}`);
};

const isProviderOutOfCredit = eval(`(${extract('isProviderOutOfCredit')})`);
const isTransientUpstream = eval(`(${extract('isTransientUpstream')})`);

test('the real provider-exhausted message is recognised', () => {
    // Verbatim from the gateway during the 2026-08-04 outage.
    assert.equal(isProviderOutOfCredit('预扣费额度失败, 用户剩余额度: $ 0.207692, 需要预扣'), true);
    assert.equal(isProviderOutOfCredit('insufficient_user_quota'), true);
    assert.equal(isProviderOutOfCredit('provider_account_out_of_credit'), true);
});

test('ordinary failures are not mistaken for an outage', () => {
    assert.equal(isProviderOutOfCredit('Unknown model'), false);
    assert.equal(isProviderOutOfCredit('the upstream provider is temporarily unavailable'), false);
    assert.equal(isProviderOutOfCredit(''), false);
    assert.equal(isProviderOutOfCredit(null), false);
});

test('an exhausted wallet is never retried as a transient blip', () => {
    // Retrying it three times only delays the truth by three attempts.
    assert.equal(isTransientUpstream('预扣费额度失败, 用户剩余额度: $ 0.207692'), false);
    // ...while genuine blips still retry.
    assert.equal(isTransientUpstream('the upstream provider is temporarily unavailable'), true);
    assert.equal(isTransientUpstream('ECONNRESET'), true);
    assert.equal(isTransientUpstream('429 rate limit'), true);
});
