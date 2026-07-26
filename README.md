## THIS IS THE DESKTOP APP

TO RUN IT YOU NEED TO 

```bash
git clone https://github.com/erenakyildiz-code/PublicBaratrumDesktopApp.git
cd PublicBaratrumDesktopApp
npm i
npm run dev
```

YOU CAN CHANGE THE VRM MODEL TO SOMETHING YOU WANT TO USE:
/src/renderer/public/model.vrm 
IS WHAT THE APP USES

LOOK AT /src/renderer/index.html

YOU CAN SEE ANIMATION OPTIONS, YOU CAN LOAD ANIMATIONS BY PUTTING THEM IN 
/src/renderer/public

AND SETTING THE CORRECT OPTION IN /src/renderer/index.html

FOR SOME REASON ELECTRON BREAKS ON LINUX SO BELOW IS THE FIX:


## Troubleshooting: "Error: Electron uninstall" on `npm run dev`

npm ≥ 12 blocks dependency install scripts by default, so Electron's
binary is never downloaded on `npm install`. If you hit
`Error: Electron uninstall` when starting the dev server, fix it by
installing the binary manually (run from the project root):

```bash
# 1. Download the Electron binary (check package.json for the version)
ELECTRON_VERSION=$(node -p "require('./package.json').devDependencies.electron.replace(/[^0-9.]/g, '')")
wget -O /tmp/electron.zip "https://npmmirror.com/mirrors/electron/${ELECTRON_VERSION}/electron-v${ELECTRON_VERSION}-linux-x64.zip"

# 2. Extract it where the postinstall script would have put it
mkdir -p node_modules/electron/dist
unzip -o /tmp/electron.zip -d node_modules/electron/dist
echo -n "electron" > node_modules/electron/path.txt
chmod +x node_modules/electron/dist/electron

# 3. Verify — should show an ELF executable and the word "electron"
file node_modules/electron/dist/electron
cat node_modules/electron/path.txt && echo
```

Then `npm run dev` should start normally.
<img width="597" height="1055" alt="image" src="https://github.com/user-attachments/assets/6d1b8bc8-9ed5-4d9b-af3d-0e7d3d528c19" />
