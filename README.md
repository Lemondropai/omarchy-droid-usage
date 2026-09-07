# Droid Usage for Omarchy

A native Omarchy bar widget for live [Factory](https://factory.ai/) Droid usage.

## Features

- Standard and Droid Core 5-hour, weekly, and monthly usage
- Managed Computers monthly compute usage
- Automatic refresh every 20 seconds
- Last-known values retained and marked stale during temporary failures
- Left-click opens the usage panel
- Right-click opens the Droid CLI in an Omarchy terminal

The Standard / Droid Core switch changes only the displayed pool. It does not
change Factory account settings.

## Requirements

- Omarchy Quattro
- Factory Droid CLI installed at `~/.local/bin/droid`
- An active Droid CLI login
- Node.js 18 or newer
- `secret-tool` when the Droid login uses the system keyring

The plugin uses only Node.js built-in modules. It has no npm dependencies.

## Install

```bash
omarchy plugin add https://github.com/Lemondropai/omarchy-droid-usage --enable
```

If the widget does not appear immediately:

```bash
omarchy-shell shell rescanPlugins
```

## Use

- Left-click the Factory mark to open or close the usage panel.
- Right-click the Factory mark to launch Droid.
- Choose **Standard** or **Droid Core** inside the panel.
- Press `R` while the panel is focused to refresh immediately.

## Data access and storage

This plugin reads the encrypted login already created by the Droid CLI. It
does not store or print access or refresh tokens. The access token is sent
only to Factory's API over HTTPS to read:

- Billing limits
- Managed Computers usage

The plugin writes a mode-`0600` usage snapshot to:

```text
${XDG_STATE_HOME:-~/.local/state}/omarchy/agents/usage/droid.json
```

The snapshot contains usage totals and reset times, not credentials. The
display-only pool preference is stored at:

```text
~/.config/omarchy/droid-usage-pool
```

Factory's usage endpoints and Droid credential storage are not documented as
stable public interfaces. A future Droid or Factory update may require a
plugin update.

## Remove

```bash
omarchy plugin remove io.github.lemondropai.droid-usage --yes
```

Removal does not delete the generated usage snapshot or pool preference. To
remove those files too:

```bash
rm -f "${XDG_STATE_HOME:-$HOME/.local/state}/omarchy/agents/usage/droid.json"
rm -f "$HOME/.config/omarchy/droid-usage-pool"
```

## Development

```bash
node --test test/droid-usage.test.mjs
node --check droid-usage.mjs
qmllint -I /usr/lib/qt6/qml Agent.qml Main.qml Panel.qml
omarchy plugin validate .
```

## License and trademarks

The source code is available under the [MIT License](LICENSE). See
[Third-Party Notices](THIRD_PARTY_NOTICES.md) for upstream code and asset
attribution.

Factory, Droid, and the Factory mark are trademarks of Factory AI. This
project is an independent community plugin and is not endorsed by Factory AI
or Omarchy.
