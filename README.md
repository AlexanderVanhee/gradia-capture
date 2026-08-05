<div align="center">
  <img src="https://github.com/user-attachments/assets/03ba0ce8-aa83-4f9e-b829-23a66ec599cc" alt="logo" width="150"/>
  <h1>Gradia Capture</h1>
</div>

<br/>
<div align="center">
  <p style="margin-bottom: 16px;">
    Enhances the GNOME built-in screenshot tool with the annotation features you would expect.
  </p>

  <img width="1920" height="1080" alt="Screenshot From 2026-04-25 10-51-19" src="https://github.com/user-attachments/assets/e1969f03-b07b-4cd3-9b4c-dc6c53d8d402" />
</div>
<br/>

Includes features like annotations, custom saving options and integration with the [Gradia App from Flathub](https://flathub.org/en/apps/be.alexandervanhee.gradia), including OCR text recognition.

> [!IMPORTANT]
> Unlike the Gradia app, this extension is not part of GNOME Circle.

> [!IMPORTANT]
> The [GNOME Code of Conduct](https://conduct.gnome.org) applies to this project, including this repository.

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/AlexanderVanhee/gradia-capture.git
cd gradia-capture
```

### 2. Build and install

Run the following command from the root directory of the cloned repo:

```bash
./build.sh -i
```

The `-i` flag tells the script to both build the project and install it automatically.

## Translations

The extension is translated with gettext. Translation files live in the [`po/`](po/) directory:

- `po/zh_CN.po` — Simplified Chinese (简体中文)
- `po/gradia-capture.pot` — translation template (all source strings)
- `po/POTFILES` — files that contain translatable strings

`build.sh` compiles the `.po` files into `.mo` catalogs (using `msgfmt`, or the bundled `po/compile_mo.py` fallback when gettext is not installed) and packs them into the extension under `locale/`.

To add a new language:

1. Copy `po/gradia-capture.pot` to `po/<LANG>.po` (e.g. `po/fr.po`).
2. Fill in the `msgstr` translations.
3. Re-run `./build.sh -i`.

User-facing strings are wrapped with `gettext()` (`_()`) in the source under [`src/`](src/).
