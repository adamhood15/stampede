<?php
if (!defined('ABSPATH')) exit;

/**
 * Outputs the small fetch-token-then-redirect-on-submit snippet on whatever
 * page is configured as the gate (`waterpark_gate_page_id`, shared with
 * Waterpark_Leaderboard_Game_Router). Lives in the plugin rather than
 * code-snippets — Code Snippets scopes by everywhere/front-end/admin, not
 * by a specific page, without its Pro conditional-logic add-on.
 *
 * The redirect-on-submit half is intentionally NOT wired yet — it needs a
 * real WS Form on this page to confirm the actual "submit succeeded" JS
 * event name against the live WS Form Pro install. Until then this exposes
 * window.WaterparkGate.redirectToGame() for manual/console wiring.
 */
class Waterpark_Leaderboard_Gate_Page {

    const PAGE_ID_OPTION = 'waterpark_gate_page_id';

    public static function maybe_print_snippet() {
        $gate_page_id = (int) get_option(self::PAGE_ID_OPTION);

        if (!$gate_page_id || !is_page($gate_page_id)) {
            return;
        }

        $token_endpoint = esc_url_raw(rest_url('waterpark-leaderboard/v1/gate-token'));
        // Must match Waterpark_Leaderboard_Game_Router's rewrite rule.
        $game_url       = esc_url_raw(home_url('/stampede-wild-rush/play/'));
        ?>
        <script>
        (function () {
          var gameUrl = <?php echo wp_json_encode($game_url); ?>;
          var token = null;

          fetch(<?php echo wp_json_encode($token_endpoint); ?>)
            .then(function (r) { return r.json(); })
            .then(function (data) { token = data.token; })
            .catch(function (e) { console.error('Waterpark gate: token fetch failed', e); });

          // Player must opt into at least one channel (SMS field_152 or
          // email field_146) to reach the game — matches this form's own
          // "wsf-1-field-152/146" checkbox IDs, not a generic selector.
          function hasOptIn() {
            var sms = document.getElementById('wsf-1-field-152-row-1');
            var email = document.getElementById('wsf-1-field-146-row-1');
            return (sms && sms.checked) || (email && email.checked);
          }

          // Runs before WS Form's own submit handler (capture phase fires
          // first regardless of listener registration order) so an
          // unchecked form never reaches Mailchimp at all, not just never
          // reaches the game.
          document.addEventListener('DOMContentLoaded', function () {
            var sms = document.getElementById('wsf-1-field-152-row-1');
            var form = sms ? sms.closest('form') : null;
            if (!form) {
              console.error('Waterpark gate: consent checkboxes/form not found, cannot wire opt-in guard');
              return;
            }

            var errorEl = document.getElementById('waterpark-gate-consent-error');
            if (!errorEl) {
              errorEl = document.createElement('div');
              errorEl.id = 'waterpark-gate-consent-error';
              errorEl.style.color = '#b3261e';
              errorEl.style.marginTop = '8px';
              errorEl.style.display = 'none';
              errorEl.textContent = 'Please check the SMS or email opt-in box to continue.';
              form.appendChild(errorEl);
            }

            form.addEventListener('submit', function (e) {
              if (!hasOptIn()) {
                e.preventDefault();
                e.stopImmediatePropagation();
                errorEl.style.display = 'block';
                errorEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
              } else {
                errorEl.style.display = 'none';
              }
            }, true);
          });

          window.WaterparkGate = {
            redirectToGame: function () {
              // Safety net — the submit guard above should already have
              // blocked getting here without consent.
              if (!hasOptIn()) {
                console.error('Waterpark gate: reached redirectToGame() without opt-in consent, not redirecting');
                return;
              }
              if (!token) {
                console.error('Waterpark gate: no token yet, cannot redirect');
                return;
              }
              location.href = gameUrl + '?t=' + encodeURIComponent(token);
            },
          };
        })();
        </script>
        <?php
    }
}
