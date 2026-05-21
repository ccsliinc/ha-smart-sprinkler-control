# 💧 Smart Sprinkler Control

Professional Home Assistant integration for intelligent sprinkler and irrigation system management with Zero Sensor Pollution Architecture.

---

## 🌟 **Features**

✅ **Zero Sensor Pollution**: Single comprehensive sensor with rich attributes instead of dozens of individual sensors
✅ **Smart Weather Integration**: Automatic rain delay and duration adjustment based on weather conditions
✅ **Advanced Scheduling**: Create complex watering schedules with per-zone duration control
✅ **Zone Management**: Individual zone control with flow rate tracking and water usage statistics
✅ **Professional UI**: Modern frontend panel with real-time status and controls
✅ **Rain Delay System**: Manual and automatic rain delay with configurable duration
✅ **Water Usage Tracking**: Daily and weekly statistics for each zone and system total
✅ **HACS Ready**: Easy installation through Home Assistant Community Store

---

## 📦 **Installation**

### **HACS Installation (Recommended)**

1. Open HACS in Home Assistant
2. Go to "Integrations"
3. Click the "+" button
4. Search for "Smart Sprinkler Control"
5. Click "Download"
6. Restart Home Assistant
7. Go to Settings → Devices & Services → Add Integration
8. Search for "Smart Sprinkler Control"

### **Manual Installation**

1. Download the latest release from GitHub
2. Extract to `custom_components/smart_sprinkler_control/`
3. Restart Home Assistant
4. Add integration through Settings → Devices & Services

---

## ⚙️ **Configuration**

### **Initial Setup**

1. **Add Integration**: Settings → Devices & Services → Add Integration → Smart Sprinkler Control
2. **System Name**: Enter a name for your sprinkler system (e.g., "Front Yard Sprinklers")
3. **Zone Count**: Configure the number of sprinkler zones (1-32 zones supported)
4. **Zone Names**: Customize names for each zone (e.g., "Front Lawn", "Back Garden", "Flower Beds")

### **Optional Weather Integration**

- **Weather Entity**: Select your weather integration entity for automatic rain detection
- **Rain Sensor**: Configure a binary rain sensor entity for immediate rain detection
- **Rain Threshold**: Set precipitation threshold for automatic rain delay (default: 0.1 inches)

---

## 🎮 **Usage**

### **Services Available**

#### **Zone Control Services**
```yaml
# Start a specific zone
service: smart_sprinkler_control.start_zone
data:
  entity_id: sensor.sprinkler_system
  zone_id: 1
  duration: 15  # minutes

# Stop a specific zone
service: smart_sprinkler_control.stop_zone
data:
  entity_id: sensor.sprinkler_system
  zone_id: 1

# Stop all zones
service: smart_sprinkler_control.stop_all_zones
data:
  entity_id: sensor.sprinkler_system
```

#### **System Control Services**
```yaml
# Enable rain delay
service: smart_sprinkler_control.enable_rain_delay
data:
  entity_id: sensor.sprinkler_system
  hours: 24

# Disable rain delay
service: smart_sprinkler_control.disable_rain_delay
data:
  entity_id: sensor.sprinkler_system
```

#### **Schedule Management Services**
```yaml
# Create a watering schedule
service: smart_sprinkler_control.create_schedule
data:
  entity_id: sensor.sprinkler_system
  schedule_id: "morning_schedule"
  name: "Morning Watering"
  zone_ids: [1, 2, 3]
  start_time: "06:00"
  days_of_week: [0, 2, 4, 6]  # Mon, Wed, Fri, Sun
  zone_durations:
    1: 15
    2: 20
    3: 10
```

### **Entity Data Structure**

The integration creates a single sensor entity with comprehensive attributes:

```yaml
sensor.sprinkler_system:
  state: "idle"  # idle, watering_N_zones, scheduled, rain_delayed, disabled
  attributes:
    system_name: "Front Yard Sprinklers"
    total_zones: 8
    active_zones: 0
    scheduled_zones: 2
    enabled_zones: 8
    rain_delay_active: false
    total_water_today: 45.2  # gallons
    total_runtime_today: 120  # minutes
    zone_details:
      zone_1:
        name: "Front Lawn"
        state: "idle"
        enabled: true
        remaining_duration: 0
        can_start: true
        is_watering: false
        total_runtime_today: 30
        total_water_today: 12.5
        settings:
          duration: 15
          flow_rate: 2.5
          area_sqft: 500
```

---

## 🎨 **Frontend Panel**

Access the professional control panel at `/smart-sprinkler-control` with features:

- **Real-time Zone Status**: Live status cards for each zone
- **Manual Controls**: Start/stop buttons with duration sliders
- **Schedule Management**: Create and manage watering schedules
- **System Statistics**: Water usage and runtime statistics
- **Weather Integration**: Current conditions and rain delay status
- **Zone Configuration**: Edit zone names, durations, and flow rates

---

## 🤖 **Automation Examples**

### **Smart Rain Delay**
```yaml
automation:
  - alias: "Auto Rain Delay"
    trigger:
      - platform: numeric_state
        entity_id: sensor.precipitation_today
        above: 0.1
    action:
      - service: smart_sprinkler_control.enable_rain_delay
        data:
          entity_id: sensor.sprinkler_system
          hours: 48
```

### **Morning Watering Routine**
```yaml
automation:
  - alias: "Morning Sprinklers"
    trigger:
      - platform: time
        at: "06:00:00"
    condition:
      - condition: state
        entity_id: sensor.sprinkler_system
        attribute: rain_delay_active
        state: false
    action:
      - service: smart_sprinkler_control.start_zone
        data:
          entity_id: sensor.sprinkler_system
          zone_id: "{{ item }}"
          duration: 15
        loop:
          - 1
          - 2
          - 3
```

### **Water Usage Notification**
```yaml
automation:
  - alias: "High Water Usage Alert"
    trigger:
      - platform: numeric_state
        entity_id: sensor.sprinkler_system
        attribute: total_water_today
        above: 100
    action:
      - service: notify.mobile_app
        data:
          message: "Sprinkler system used {{ states.sensor.sprinkler_system.attributes.total_water_today }} gallons today"
```

---

## 🛠️ **Development**

### **Setup Development Environment**
```bash
# Clone repository
git clone https://github.com/ccsliinc/ha-smart-sprinkler-control.git
cd ha-smart-sprinkler-control

# Setup development environment
./scripts/setup_dev.sh

# Run tests
pytest

# Code quality checks
pre-commit run --all-files
```

### **Project Structure**
```
custom_components/smart_sprinkler_control/
├── __init__.py              # Integration entry point
├── config_flow.py          # Configuration UI
├── sensor.py               # Summary sensor (THE HEART)
├── const.py                # Constants and service definitions
├── manifest.json           # HACS metadata
│
├── models/                 # Data Models
│   └── zone.py             # Zone and system dataclasses
│
├── services/               # Business Logic (THE BRAIN)
│   ├── zone_services.py    # Zone control operations
│   ├── system_services.py  # System-wide operations
│   ├── schedule_services.py # Schedule management
│   └── weather_services.py # Weather integration
│
├── storage/                # Data Persistence
│   └── storage.py          # State save/load
│
├── api/                    # HTTP API
│   └── http.py             # Frontend endpoints
│
├── frontend/               # Professional UI
│   ├── src/
│   │   ├── components/     # UI components
│   │   ├── modules/        # Core functionality
│   │   ├── templates/      # HTML layouts
│   │   └── utils/          # Shared utilities
│   ├── dist/               # Compiled assets
│   └── package.json        # Node.js dependencies
│
└── translations/           # Internationalization
    └── en.json             # English translations
```

---

## 🤝 **Contributing**

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

---

## 📄 **License**

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🆘 **Support**

- **Issues**: [GitHub Issues](https://github.com/ccsliinc/ha-smart-sprinkler-control/issues)
- **Discussions**: [GitHub Discussions](https://github.com/ccsliinc/ha-smart-sprinkler-control/discussions)
- **Documentation**: [Wiki](https://github.com/ccsliinc/ha-smart-sprinkler-control/wiki)

---

**🌿 Transform your irrigation system into an intelligent, efficient, and automated watering solution with Smart Sprinkler Control!**
