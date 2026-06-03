# Smart Sprinkler Control

A Home Assistant integration for zone-based irrigation. It drives your existing `switch` entities (valve relays, smart outlets, ESPHome boards) as sprinkler zones, adds scheduling and weather-aware rain skipping, and exposes everything through a single sensor instead of flooding your entity registry with dozens of per-zone helpers. Setup is done entirely through the UI config flow, and zones, switches, and weather sources can be reconfigured later without editing YAML.

[![HACS Custom](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://github.com/ccsliinc/ha-smart-sprinkler-control)
[![Home Assistant](https://img.shields.io/badge/Home%20Assistant-2024.8%2B-41BDF5.svg)](https://www.home-assistant.io/)
[![Version](https://img.shields.io/badge/version-2025.1.5-blue.svg)](https://github.com/ccsliinc/ha-smart-sprinkler-control/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-Support-orange.svg?logo=buy-me-a-coffee)](https://www.buymeacoffee.com/ccsliinc)
[![PayPal](https://img.shields.io/badge/PayPal-Donate-blue.svg?logo=paypal)](https://paypal.me/jsugamele)

## Features

- Up to 32 zones, each mapped to an existing `switch` entity.
- One summary sensor holds all zone state, schedules, and usage in its attributes. No per-zone sensor spam.
- Scheduling with per-zone durations, start times, and day-of-week selection.
- Manual rain delay (set a number of hours) plus optional weather-based skipping from a weather entity or binary rain sensor.
- Per-zone water-usage and runtime tracking when you set a flow rate.
- A frontend panel for manual control, scheduling, and per-zone settings.
- UI config flow; zones, switches, and weather sources are reconfigurable from the Configure dialog.

## Installation

### HACS (recommended)

1. In HACS, open the three-dot menu and choose **Custom repositories**.
2. Add `https://github.com/ccsliinc/ha-smart-sprinkler-control` as an **Integration**.
3. Search for **Smart Sprinkler Control** and download it.
4. Restart Home Assistant.
5. Go to **Settings → Devices & Services → Add Integration** and add **Smart Sprinkler Control**.

### Manual

1. Download the latest release.
2. Copy `custom_components/smart_sprinkler_control/` into your Home Assistant `config/custom_components/` directory.
3. Restart Home Assistant.
4. Add the integration from **Settings → Devices & Services**.

## Configuration

Configuration runs through the UI config flow. After adding the integration you'll step through:

1. **System** — name the system and choose a zone count (1–32).
2. **Zones** — name each zone.
3. **Switches** — map each zone to a `switch` entity. The integration turns these on and off; it does not talk to hardware directly.
4. **Weather** (optional) — enable weather integration and select a weather entity and/or a binary rain sensor for automatic rain skipping.

To change the setup later, open the integration in **Settings → Devices & Services** and click **Configure**. The options flow lets you adjust the zone count, rename zones, and remap zone switch entities. Per-zone settings such as default duration and flow rate are edited from the gear icon on each zone in the frontend panel.

## Services

All services target the summary sensor via `entity_id`.

| Service | Description |
| --- | --- |
| `smart_sprinkler_control.start_zone` | Start watering a zone for a given duration (minutes). |
| `smart_sprinkler_control.stop_zone` | Stop a running zone. |
| `smart_sprinkler_control.stop_all_zones` | Stop every active zone. |
| `smart_sprinkler_control.adjust_zone_time` | Change the remaining time on a running zone. |
| `smart_sprinkler_control.enable_rain_delay` | Skip watering for a number of hours. |
| `smart_sprinkler_control.disable_rain_delay` | Clear an active rain delay. |
| `smart_sprinkler_control.update_zone_settings` | Update a zone's name, default duration, or enabled state. |
| `smart_sprinkler_control.create_schedule` | Create a watering schedule (zones, start time, days). |
| `smart_sprinkler_control.delete_schedule` | Delete a schedule by ID. |
| `smart_sprinkler_control.run_schedule` | Run a schedule immediately. |

Example, starting zone 1 for 15 minutes:

```yaml
service: smart_sprinkler_control.start_zone
data:
  entity_id: sensor.smart_sprinkler_system
  zone_id: 1
  duration: 15
```

Creating a schedule:

```yaml
service: smart_sprinkler_control.create_schedule
data:
  entity_id: sensor.smart_sprinkler_system
  schedule_id: morning
  name: Morning Watering
  zone_ids: [1, 2, 3]
  start_time: "06:00"
  days_of_week: [1, 3, 5]  # Mon, Wed, Fri (0 = Sunday)
```

## Automation Examples

Skip the morning run when rain delay is active:

```yaml
automation:
  - alias: Morning sprinklers
    trigger:
      - platform: time
        at: "06:00:00"
    condition:
      - condition: state
        entity_id: sensor.smart_sprinkler_system
        attribute: rain_delay_active
        state: false
    action:
      - service: smart_sprinkler_control.start_zone
        data:
          entity_id: sensor.smart_sprinkler_system
          zone_id: 1
          duration: 15
```

Notify when daily water use crosses a threshold:

```yaml
automation:
  - alias: High water usage alert
    trigger:
      - platform: numeric_state
        entity_id: sensor.smart_sprinkler_system
        attribute: total_water_today
        above: 100
    action:
      - service: notify.mobile_app
        data:
          message: >
            Sprinklers used
            {{ state_attr('sensor.smart_sprinkler_system', 'total_water_today') }}
            gallons today.
```

## Support

- Bugs and feature requests: [GitHub Issues](https://github.com/ccsliinc/ha-smart-sprinkler-control/issues)
- Questions and ideas: [GitHub Discussions](https://github.com/ccsliinc/ha-smart-sprinkler-control/discussions)

## Support This Project

If this integration is useful to you, contributions toward its upkeep are appreciated:

- [Buy Me A Coffee](https://www.buymeacoffee.com/ccsliinc)
- [PayPal](https://paypal.me/jsugamele)

## License

Released under the MIT License. See [LICENSE](LICENSE) for details.
