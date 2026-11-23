# Integrations overview

Integrations expose **triggers** (IF / SOURCE) and **actions** (ACTION / ELSE / CATCH). Configure secrets under **Integrations** in the UI (`config/integrations.yaml`).

| Id | Name | Typical use |
| -- | ---- | ----------- |
| `time` | Time | Poll interval / daily at |
| `weather` | Weather | Temp conditions + report SOURCE |
| `wifi` | Wi‑Fi | Device on LAN |
| `telegram` | Telegram | Send messages |
| `gmail` | Gmail | Send email |
| `homeassistant` | Home Assistant | Entity state / services |
| `zigbee` | Zigbee | Zigbee2MQTT state / set |
| `googledocs` / `googlesheets` | Google | Docs & Sheets |
| `notion` | Notion | Pages |
| `cursor` | Cursor Agent | Launch cloud agents |
| `script` | Shell script | Inline or file scripts |
| *(custom)* | Your HTTP APIs | Created via Agent chat |

Built-ins are TypeScript modules. **Custom** integrations are HTTP definitions in `config/custom-integrations.yaml` — see [Custom HTTP](/integrations/custom).
