#!/bin/bash
# Script to build the extension zip and install the package
#
# This Script is released under GPL v3 license
# Copyright (C) 2020-2025 Javad Rahmatzadeh
# Copyright (C) 2025 Alexander Vanhee

set -e
cd "$( cd "$( dirname "$0" )" && pwd )"

echo "Packing extension..."
gnome-extensions pack src \
    --force \
    --extra-source="LICENSE" \
    --extra-source="README.md" \
    $(find src -maxdepth 1 -name '*.js' ! -name 'extension.js' -printf '--extra-source=%f ') \
    --extra-source="../icons" \
    --podir="../po" \
    --gettext-domain="gradia-capture" \
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