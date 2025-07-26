# Localization and custom phrases

Since **v2.0.0** the card supports dynamic localization. It automatically follows the language set in Home Assistant and loads a matching file from `src/locales`.

1. The card first looks for an exact match such as `en-GB.json`.
2. If that is missing it falls back to the language part, e.g. `en.json`.
3. If no matching file is found it uses `en.json` as the default.

## Provided locales

This repository includes:

- `src/locales/sv.json`
- `src/locales/en.json`
- `src/locales/de.json`

## Adding a new language

1. Copy `src/locales/en.json` to `src/locales/xx.json` (or `xx-YY.json` for a region variant).
2. Translate all values in the file.
3. Open a pull request or create an issue to share your translation.

Because the card uses dynamic imports there is no further code change required—the new file will be picked up automatically.

## Custom phrases

In minimal mode some allergens may be shortened in a way you do not like. You can override text strings with the `phrases` options. Only include the keys you want to customise:

```yaml
# your current config
phrases:
  short:
    Malörtsambrosia: Ambrs
    Sälg och viden: Sälg
```

See [docs/configuration.md](configuration.md) for all phrase options and other settings.

