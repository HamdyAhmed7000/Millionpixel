import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import {readFileSync} from 'node:fs';
export default defineConfig({plugins:[react(),{name:'celltalk-publisher-files',generateBundle(){this.emitFile({type:'asset',fileName:'ads.txt',source:readFileSync(new URL('./ads.txt',import.meta.url),'utf8')});}}],build:{rollupOptions:{input:{main:'index.html',privacy:'privacy.html'}}}});
