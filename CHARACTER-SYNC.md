# Character sync contract

The web app listens on the existing TarkovMonitor relay for a `characterProfile` command. It uses the same four-character remote ID as map and position events:

```json
{
  "type": "command",
  "sessionID": "ABCD",
  "data": {
    "type": "characterProfile",
    "profile": {
      "accountId": "account-id",
      "profileId": "profile-id",
      "gameMode": "regular",
      "nickname": "DUDGY",
      "side": "Usec",
      "raidSide": "PMC",
      "level": 42,
      "experience": 987654
    },
    "customization": {
      "Head": "24-character-template-id",
      "Body": "24-character-template-id",
      "Feet": "24-character-template-id",
      "Hands": "24-character-template-id"
    },
    "equipment": [
      {
        "_id": "item-instance-id",
        "_tpl": "24-character-template-id",
        "parentId": null,
        "slotId": "FirstPrimaryWeapon",
        "name": "M4A1",
        "upd": {}
      }
    ]
  }
}
```

PascalCase monitor objects are accepted too (`Profile`, `Info`, `Equipment.Items`, `Customization`, `Name`, `SlotId`, `Upd`). The client allowlists identity, appearance, equipment, and a small set of item properties before writing to `party_members.character_snapshot`; raw profile JSON is never stored.

The party member’s Character Sync control has three modes:

- `FULL`: nickname, faction, level, appearance, and loadout.
- `IDENTITY`: nickname, faction, level, and game mode only.
- `OFF`: clears the stored snapshot and ignores future profile events.

The first profile seen for a linked monitor is held locally and shown as a confirmation prompt (`Found DUDGY / USEC / LEVEL 42 — use this character?`). Nothing is written to the party until the user accepts it. Once accepted, later loadout refreshes for the same account/profile update automatically; a different identity requires confirmation again.

Run `node scripts/fake-monitor.mjs <REMOTE_ID> --profile` to exercise the complete relay-to-party path. The real TarkovMonitor emitter should publish the same event after it has loaded the profile and `PlayerVisualRepresentation` from the raid-ready log event.
