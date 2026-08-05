#!/bin/bash
# Script to build the extension zip and install the package
#
# This Script is released under GPL v3 license
# Copyright (C) 2020-2025 Javad Rahmatzadeh
# Copyright (C) 2025 Alexander Vanhee

set -e
cd "$( cd "$( dirname "$0" )" && pwd )"

echo "Compiling translations..."
LOCALE_DIR="locale"
rm -rf "$LOCALE_DIR"
mkdir -p "$LOCALE_DIR"
for po in po/*.po; do
    [ -e "$po" ] || continue
    lang="$(basename "$po" .po)"
    mo_file="$LOCALE_DIR/$lang/LC_MESSAGES/gradia-capture.mo"
    mkdir -p "$(dirname "$mo_file")"
    if command -v msgfmt >/dev/null 2>&1; then
        msgfmt --check -o "$mo_file" "$po"
    elif command -v python3 >/dev/null 2>&1; then
        python3 po/compile_mo.py "$po" "$mo_file"
    else
        echo "WARNING: msgfmt and python3 not found, skipping $po"
    fi
done
echo "Translations compiled!"

echo "Packing extension..."
gnome-extensions pack src \
    --force \
    --extra-source="LICENSE" \
    --extra-source="README.md" \
    $(find src -maxdepth 1 -name '*.js' ! -name 'extension.js' -printf '--extra-source=%f ') \
    --extra-source="../icons" \
    --extra-source="../locale" \
    --schema="../schemas/org.gnome.shell.extensions.gradia-companion.gschema.xml"
echo "Packing Done!"

while getopts i flag; do
    case $flag in
        i)  gnome-extensions install --force \
                gradia-integration@alexandervanhee.github.io.shell-extension.zip && \
            echo "Extension is installed. Now restart the GNOME Shell." || \
            { echo "ERROR: Could not install the extension!"; exit 1; };;
        *)  echo "ERROR: Invalid flag!"
            echo "Use '-i' to install the extension to your system."
            echo "To just build it, run the script without any flag."
            exit 1;;
    esac
done