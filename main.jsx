import RadioProvider from './RadioPlayer.jsx';
import {supabase} from './supabase.js';
import React from 'react';
import {createRoot} from 'react-dom/client';
import Portal from './Portal.jsx';
import './index.css';
import './siteTheme.css';
createRoot(document.getElementById('root')).render(<React.StrictMode><RadioProvider supabase={supabase}><Portal/></RadioProvider></React.StrictMode>);
