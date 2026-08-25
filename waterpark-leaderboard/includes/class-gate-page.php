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
        $game_url       = esc_url_raw(home_url('/play/'));
        ?>
        <script>
        (function () {
          var gameUrl = <?php echo wp_json_encode($game_url); ?>;
          var token = null;

          fetch(<?php echo wp_json_encode($token_endpoint); ?>)
            .then(function (r) { return r.json(); })
            .then(function (data) { token = data.token; })
            .catch(function (e) { console.error('Waterpark gate: token fetch failed', e); });

          window.WaterparkGate = {
            redirectToGame: function () {
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
