use tide_bot::{clamp_to_monitor, MonitorBounds};

#[test]
fn clamps_a_saved_position_into_the_current_monitor_work_area() {
    let monitor = MonitorBounds {
        x: 0,
        y: 0,
        width: 1440,
        height: 900,
    };
    assert_eq!(clamp_to_monitor(&monitor, 9000, 9000, (380, 520)), (1060, 380));
}

#[test]
fn keeps_an_on_screen_position_unchanged() {
    let monitor = MonitorBounds {
        x: 0,
        y: 0,
        width: 1440,
        height: 900,
    };
    assert_eq!(clamp_to_monitor(&monitor, 100, 100, (380, 520)), (100, 100));
}

#[test]
fn re_clamps_negative_offsets_into_the_work_area() {
    let monitor = MonitorBounds {
        x: 0,
        y: 0,
        width: 1440,
        height: 900,
    };
    assert_eq!(clamp_to_monitor(&monitor, -200, -200, (380, 520)), (0, 0));
}

#[test]
fn honours_a_non_zero_monitor_origin() {
    let monitor = MonitorBounds {
        x: 1920,
        y: 100,
        width: 1440,
        height: 900,
    };
    // Window width 380, height 520 → max x = 1920 + 1440 - 380 = 2980,
    // max y = 100 + 900 - 520 = 480.
    assert_eq!(clamp_to_monitor(&monitor, 9000, 9000, (380, 520)), (2980, 480));
}
