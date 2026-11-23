# Data layout

```
DATA_ROOT/
  rules/
    <rule-id>.yaml
  config/
    integrations.yaml           # secrets / settings by integration id
    custom-integrations.yaml    # custom HTTP catalog
    chat-sessions.json          # agent chat history
    runs.json                   # recent run log
```

In Docker, `./rules` and `./config` mount to `/data/rules` and `/data/config`.
