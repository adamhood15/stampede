<?php
if (!defined('ABSPATH')) exit;

/**
 * Submission-layer claim logic: validates a reel pick against the closed
 * word set, resolves suffix collisions, and mints a login-less token.
 *
 * NAME_A / NAME_B / BAD_NUM mirror index.html's arrays exactly (search that
 * file for "const NAME_A"). There is no build step tying the two together —
 * if the reel words or blocklist are ever changed on the client, they must
 * be changed here too, or a legitimate reel pick will be rejected as invalid.
 */
class Waterpark_Leaderboard_Name_Pool {

    const NAME_A = array(
        "Dusty", "Rowdy", "Soggy", "Rusty", "Lucky", "Wild", "Trusty", "Sandy",
        "Muddy", "Sunbaked", "Splashy", "Gritty", "Speedy", "Bouncy", "Rugged", "Breezy",
        "Sizzlin'", "Drippy", "Twisty", "Wobbly", "Hasty", "Jumpy", "Zippy", "Peppy", "Sunny",
        "Stormy", "Boomin'", "Rollin'", "Tumblin'", "Whistlin'", "Hollerin'", "Ramblin'",
        "Roamin'", "Frosty", "Dizzy", "Scrappy", "Plucky", "Nimble", "Sturdy", "Cheerful",
        "Scorchin'", "Blazing", "Weathered", "Leathery", "Windswept", "Sunburnt", "Rangy",
        "Wiry", "Feisty", "Hardy", "Hitchin'", "Stampedin'", "Canyon-bred", "Corral-tough",
        "Untamed", "Free-roamin'", "Yippin'", "Whoopin'", "Hootin'", "Rodeo-ready",
        "Rip-roarin'", "Wranglin'", "Saddlesore", "Rootin'-tootin'", "Barnstormin'",
        "Spurred", "Ranch-raised", "Dune-hoppin'", "Sagebrush", "Prairie-bred",
        "Trailworn", "Splashin'", "Drenched", "Soaked", "Waterlogged", "Bubbly", "Foamy",
        "Fizzy", "Slick", "Sloshy", "Wavy", "Rippling", "Gushing", "Misty",
        "Dewy", "Damp", "Drizzly", "Poolside", "Tubular", "Slidin'", "Divin'",
        "Cannonballin'", "Floatin'", "Bobbin'", "Sudsy", "Frothy", "Sparkling", "Chilly",
        "Dripping",
    );

    const NAME_B = array(
        "Longhorn", "Armadillo", "Bronco", "Rattler", "Buckaroo", "Coyote",
        "Tumbleweed", "Mustang", "Wrangler", "Stallion", "Roadrunner", "Jackrabbit", "Cactus",
        "Sheriff", "Ranger", "Drifter", "Maverick", "Cowpoke", "Prairiedog", "Bluebonnet",
        "Cannonball", "Riptide", "Bellyflop", "Flume", "Geyser", "Gator", "Catfish", "Otter",
        "Pelican", "Dolphin", "Splashdown", "Whirlpool", "Ripcurl", "Sunfish", "Seahorse",
        "Bullfrog", "Turtle", "Minnow", "Anchor", "Torpedo",
        "Deputy", "Outlaw", "Bandit", "Gunslinger", "Pioneer", "Trailblazer", "Rustler",
        "Vaquero", "Rancher", "Buffalo", "Bison", "Mule", "Burro", "Bobcat", "Sidewinder",
        "Scorpion", "Vulture", "Buzzard", "Falcon", "Wildcat", "Lariat", "Corral", "Canyon",
        "Mesa", "Butte", "Frontier", "Homestead", "Chuckwagon", "Stagecoach", "Wagonwheel",
        "Campfire", "Lantern", "Saloon", "Cantina", "Tidalwave", "Wavepool", "Lazyriver",
        "Waterslide", "Slipnslide", "Splashpad", "Kayak", "Jetski", "Lifeguard", "Snorkel",
        "Flipper", "Mermaid", "Narwhal", "Stingray", "Barracuda", "Piranha", "Manatee",
        "Walrus", "Pufferfish", "Jellyfish", "Starfish", "Hermitcrab", "Sandcastle",
        "Beachball", "Innertube", "Rapids",
    );

    const BAD_NUM = array(187, 322, 420, 451, 666, 911);

    // Only reached on an actual name collision — see is_valid_word() below —
    // so exhausting this is astronomically unlikely; it exists to bound the
    // loop, not because it is expected to be hit.
    const MAX_CLAIM_ATTEMPTS = 30;

    public static function is_valid_word($word, $list) {
        return in_array($word, $list, true);
    }

    protected static function pick_suffix() {
        do {
            $n = random_int(100, 999);
        } while (in_array($n, self::BAD_NUM, true));
        return $n;
    }

    public static function generate_token() {
        return bin2hex(random_bytes(16));
    }

    /**
     * @return array{token:string,player_name:string,score:int}|WP_Error
     */
    public static function claim($game_key, $adjective, $noun, $session_id = null) {
        if (!self::is_valid_word($adjective, self::NAME_A) || !self::is_valid_word($noun, self::NAME_B)) {
            return new WP_Error(
                'waterpark_invalid_name',
                'Adjective and noun must come from the closed word list.',
                array('status' => 400)
            );
        }

        $repository = new Waterpark_Leaderboard_Score_Repository();
        $base       = $adjective . ' ' . $noun;

        // First attempt is the bare pair, exactly like the client's own
        // collision loop — a suffix only ever appears after an actual clash.
        for ($attempt = 0; $attempt < self::MAX_CLAIM_ATTEMPTS; $attempt++) {
            $candidate = $attempt === 0 ? $base : $base . ' ' . self::pick_suffix();

            if ($repository->name_taken($game_key, $candidate)) {
                continue;
            }

            $token = self::generate_token();

            if ($repository->insert_new($game_key, $token, $candidate, $session_id)) {
                return array(
                    'token'       => $token,
                    'player_name' => $candidate,
                    'score'       => 0,
                );
            }

            // Lost a race to another request between the check and the
            // insert — loop again with a fresh suffix rather than erroring.
        }

        return new WP_Error(
            'waterpark_name_pool_exhausted',
            'Could not reserve a name for this word pair. Try different words.',
            array('status' => 409)
        );
    }
}
