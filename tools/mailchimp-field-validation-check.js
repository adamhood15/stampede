// Verifies per-field validation on the Mailchimp signup form
// (#mc-embedded-subscribe-form, landing.html): each of the four required
// inputs — email, SMS phone, park, consent checkbox — shows its OWN error
// message next to itself when missing/invalid, independent of the others,
// and none of them let the form actually submit (no JSONP request fires).
//
// Also verifies the happy path: all four filled in correctly submits (JSONP
// request observed) and clears any stale per-field errors.
//
// Intercepts document.createElement('script') so a JSONP attempt never
// actually reaches list-manage.com.

const { launchChrome, openPage, evaluate, VIEWPORTS } = require("./cdp");

const PORT = 9337;
const URL = "http://localhost:8000/web-components/landing/landing.html";

const HARNESS = `
  window.__mcScriptCalls = [];
  const origCreateElement = document.createElement.bind(document);
  document.createElement = function (tag) {
    const el = origCreateElement(tag);
    if (String(tag).toLowerCase() === 'script') {
      Object.defineProperty(el, 'src', {
        configurable: true,
        set(value) { window.__mcScriptCalls.push(value); },
        get() { return ''; },
      });
    }
    return el;
  };
`;

// Each case fills in the form fully valid, then knocks out exactly one
// field, submits, and checks that field's error shows while nothing else
// does, and no JSONP request was attempted.
const CASES = [
  {
    name: "missing email",
    breakField: `document.getElementById('mce-EMAIL').value = '';`,
    expectVisibleIn: "mce-EMAIL",
    expectMessage: "Please enter a valid email address.",
  },
  {
    name: "invalid email",
    breakField: `document.getElementById('mce-EMAIL').value = 'not-an-email';`,
    expectVisibleIn: "mce-EMAIL",
    expectMessage: "Please enter a valid email address.",
  },
  {
    name: "missing/incomplete phone",
    breakField: `
      phone.value = '555';
      phone.dispatchEvent(new Event('input', { bubbles: true }));
    `,
    expectVisibleIn: "mce-SMSPHONE",
    expectMessage: "Please enter a valid 10-digit phone number.",
  },
  {
    name: "no park selected",
    breakField: `
      document.getElementById('mce-MMERGE130').checked = false;
      document.getElementById('mce-MMERGE131').checked = false;
    `,
    expectVisibleIn: "mce-MMERGE130",
    expectMessage: "Please select a park.",
  },
  {
    name: "consent checkbox unchecked",
    breakField: `document.getElementById('mc-SMSPHONE-ack').checked = false;`,
    expectVisibleIn: "mc-SMSPHONE-ack",
    expectMessage: "Please check the box to continue.",
  },
];

function runCase(c) {
  return `
    (function () {
      window.__mcScriptCalls.length = 0;
      const email = document.getElementById('mce-EMAIL');
      const phone = document.getElementById('mce-SMSPHONE');
      const park = document.getElementById('mce-MMERGE130');
      const ack = document.getElementById('mc-SMSPHONE-ack');

      // Start fully valid.
      email.value = 'wyatt@example.com';
      phone.value = '5551234567';
      phone.dispatchEvent(new Event('input', { bubbles: true }));
      park.checked = true;
      ack.checked = true;

      ${c.breakField}

      document.getElementById('mc-embedded-subscribe-form')
        .querySelector('#mc-embedded-subscribe').click();

      const errors = Array.from(document.querySelectorAll('.mc-field-error'))
        .filter(el => el.classList.contains('is-visible'))
        .map(el => ({ text: el.textContent, groupHtml: el.parentElement.outerHTML.slice(0, 0) || el.parentElement.className }));

      const targetGroup = document.getElementById(${JSON.stringify(c.expectVisibleIn)}).closest('.mc-field-group, .mc-sms-phone-group');
      const targetError = targetGroup.querySelector('.mc-field-error');

      return {
        scriptCalls: window.__mcScriptCalls.length,
        visibleErrorCount: errors.length,
        targetErrorShown: !!targetError && targetError.classList.contains('is-visible'),
        targetErrorText: targetError ? targetError.textContent : null,
      };
    })()
  `;
}

async function main() {
  const chrome = await launchChrome({ port: PORT });
  try {
    const { session } = await openPage({ port: PORT, url: URL, viewport: VIEWPORTS.phone412 });
    await evaluate(session, HARNESS);

    for (const c of CASES) {
      const result = await evaluate(session, runCase(c));
      console.log(c.name + ":", result);
      if (result.scriptCalls !== 0) {
        throw new Error(`[${c.name}] form submitted (JSONP fired) despite invalid field`);
      }
      if (result.visibleErrorCount !== 1) {
        throw new Error(`[${c.name}] expected exactly 1 visible field error, got ${result.visibleErrorCount}`);
      }
      if (!result.targetErrorShown) {
        throw new Error(`[${c.name}] expected error on ${c.expectVisibleIn}'s field group, none shown there`);
      }
      if (result.targetErrorText !== c.expectMessage) {
        throw new Error(`[${c.name}] wrong message: ${result.targetErrorText}`);
      }
      console.log(`  PASS: exactly one error shown (${c.expectVisibleIn}), no submit attempted.`);
    }

    // Happy path: all four valid — submits (JSONP attempted), no field
    // errors left showing.
    const happy = await evaluate(session, `
      (function () {
        window.__mcScriptCalls.length = 0;
        document.getElementById('mce-EMAIL').value = 'wyatt@example.com';
        const phone = document.getElementById('mce-SMSPHONE');
        phone.value = '5551234567';
        phone.dispatchEvent(new Event('input', { bubbles: true }));
        document.getElementById('mce-MMERGE130').checked = true;
        document.getElementById('mc-SMSPHONE-ack').checked = true;

        document.getElementById('mc-embedded-subscribe-form')
          .querySelector('#mc-embedded-subscribe').click();

        const visible = Array.from(document.querySelectorAll('.mc-field-error'))
          .filter(el => el.classList.contains('is-visible')).length;

        return { scriptCalls: window.__mcScriptCalls.length, visibleErrorCount: visible };
      })()
    `);
    console.log("all valid:", happy);
    if (happy.scriptCalls !== 1) throw new Error("Expected the valid submit to fire exactly one JSONP request");
    if (happy.visibleErrorCount !== 0) throw new Error("Expected no field errors visible on a fully valid submit");
    console.log("  PASS: fully valid form submits, no field errors shown.");

    console.log("\nALL PASS");
  } finally {
    chrome.child.kill();
  }
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
