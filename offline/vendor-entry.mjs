// Bundled at release time. No CDN is contacted to start the offline edition.
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';

window.React = React;
window.ReactDOM = { createRoot };
window.supabase = { createClient };
