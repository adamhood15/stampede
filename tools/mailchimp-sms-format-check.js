// Verifies the Mailchimp signup form on landing.html:
//   1. rewrites the SMS phone field to E.164 (+1XXXXXXXXXX) before
//      submitting — the local "(555) 555-0100" display format Mailchimp
//      rejects with "Please provide an SMS number in the international
//      standard format".
//   2. submits via JSONP instead of a real form POST, so an error response
//      (like the one above) is shown inline in #mce-error-response instead
//      of navigating the customer to Mailchimp's own error/preference-center
//      page.
//   3. a success response is shown inline in #mce-success-response and the
//      form resets, again without navigating away.
//
// Intercepts document.createElement('script') so the JSONP request never
// actually reaches list-manage.com — this must never subscribe a real
// (fake) address to the live Mailchimp audience during a test run.

const { launchChrome, openPage, evaluate, VIEWPORTS } = require("./cdp");

const PORT = 9333;
const URL = "http://localhost:8000/web-components/landing/landing.html";

const HARNESS = `
  window.__mcTestCalls = [];
  const origCreateElement = document.createElement.bind(document);
  document.createElement = function (tag) {
    const el = origCreateElement(tag);
    if (String(tag).toLowerCase() === 'script') {
      Object.defineProperty(el, 'src', {
        configurable: true,
        set(value) {
          window.__mcTestCalls.push(value);
          const match = value.match(/[?&]c=([^&]+)/);
          const cbName = match && decodeURIComponent(match[1]);
          setTimeout(() => {
            if (cbName && typeof window[cbName] === 'function') {
              window[cbName](window.__mcTestResponse);
            }
          }, 0);
        },
        get() { return ''; },
      });
    }
    return el;
  };
`;

function fillAndSubmit(response) {
  return `
    (function () {
      window.__mcTestResponse = ${JSON.stringify(response)};
      const form = document.getElementById('mc-embedded-subscribe-form');
      const phone = document.getElementById('mce-SMSPHONE');
      const email = document.getElementById('mce-EMAIL');
      const park = document.getElementById('mce-MMERGE130');
      const ack = document.getElementById('mc-SMSPHONE-ack');
      const errorEl = document.getElementById('mce-error-response');
      const successEl = document.getElementById('mce-success-response');

      email.value = 'wyatt@example.com';
      park.checked = true;
      ack.checked = true;
      phone.value = '5551234567';
      phone.dispatchEvent(new Event('input', { bubbles: true }));

      const locationBefore = location.href;

      return new Promise((resolve, reject) => {
        let waited = 0;
        const poll = setInterval(() => {
          waited += 20;
          const shown = errorEl.style.display === 'block' || successEl.style.display === 'block';
          if (shown) {
            clearInterval(poll);
            resolve({
              scriptSrcs: window.__mcTestCalls,
              errorShown: errorEl.style.display === 'block',
              errorText: errorEl.textContent,
              successShown: successEl.style.display === 'block',
              successText: successEl.textContent,
              phoneValueAfter: phone.value,
              navigated: location.href !== locationBefore,
            });
          } else if (waited > 2000) {
            clearInterval(poll);
            reject(new Error('Timed out waiting for response UI'));
          }
        }, 20);
        form.querySelector('#mc-embedded-subscribe').click();
      });
    })()
  `;
}

async function main() {
  const chrome = await launchChrome({ port: PORT });
  try {
    const { session } = await openPage({ port: PORT, url: URL, viewport: VIEWPORTS.phone412 });
    await evaluate(session, HARNESS);

    // Case 1: Mailchimp rejects the SMS format.
    const errorResult = await evaluate(session, fillAndSubmit({
      result: "error",
      msg: "0 - Please provide an SMS number in the international standard format",
    }), { awaitPromise: true });
    console.log("Error-case result:", errorResult);

    if (errorResult.navigated) throw new Error("Page navigated away on error — should stay on landing.html");
    if (!errorResult.scriptSrcs.some((s) => /\/post-json\?/.test(s) && /SMSPHONE=%2B15551234567/.test(s))) {
      throw new Error("JSONP request did not carry the E.164 phone number: " + JSON.stringify(errorResult.scriptSrcs));
    }
    if (!errorResult.errorShown || errorResult.successShown) throw new Error("Expected only the error response to show");
    if (errorResult.errorText.indexOf("international standard format") === -1) {
      throw new Error("Error message not shown inline: " + errorResult.errorText);
    }
    if (errorResult.phoneValueAfter !== "(555) 123-4567") {
      throw new Error("Phone field should be restored to local display format after an error, got: " + errorResult.phoneValueAfter);
    }
    console.log("PASS: error response shown inline, no navigation, phone field restored.");

    // Reload for a clean slate, then case 2: success.
    await evaluate(session, `location.reload()`);
    await new Promise((r) => setTimeout(r, 500));
    await evaluate(session, HARNESS);

    const successResult = await evaluate(session, fillAndSubmit({
      result: "success",
      msg: "Almost finished...",
    }), { awaitPromise: true });
    console.log("Success-case result:", successResult);

    if (successResult.navigated) throw new Error("Page navigated away on success — should stay on landing.html");
    if (!successResult.successShown || successResult.errorShown) throw new Error("Expected only the success response to show");
    console.log("PASS: success response shown inline, no navigation.");
  } finally {
    chrome.child.kill();
  }
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
