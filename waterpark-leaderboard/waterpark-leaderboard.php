<?php
/**
 * Plugin Name: Waterpark Leaderboard
 * Description: Custom table storage and REST submission layer for the Stampede waterpark game leaderboard. See database-plan.md for the schema design.
 * Version: 1.0.0
 */

if (!defined('ABSPATH')) exit;

define('WATERPARK_LEADERBOARD_VERSION', '1.0.0');
define('WATERPARK_LEADERBOARD_DB_VERSION', '1.0');
define('WATERPARK_LEADERBOARD_DB_VERSION_OPTION', 'waterpark_leaderboard_db_version');
define('WATERPARK_LEADERBOARD_DEFAULT_GAME_KEY', 'waterpark');
define('WATERPARK_LEADERBOARD_PATH', plugin_dir_path(__FILE__));

require_once WATERPARK_LEADERBOARD_PATH . 'includes/class-database.php';
require_once WATERPARK_LEADERBOARD_PATH . 'includes/class-score-repository.php';
require_once WATERPARK_LEADERBOARD_PATH . 'includes/class-name-pool.php';
require_once WATERPARK_LEADERBOARD_PATH . 'includes/class-rest-controller.php';

register_activation_hook(__FILE__, array('Waterpark_Leaderboard_DB', 'install'));

// Catches schema drift after a plugin update, not just first activation —
// dbDelta() is safe to re-run and only applies the diff.
add_action('plugins_loaded', array('Waterpark_Leaderboard_DB', 'maybe_upgrade'));

add_action('rest_api_init', array('Waterpark_Leaderboard_REST_Controller', 'register_routes'));
