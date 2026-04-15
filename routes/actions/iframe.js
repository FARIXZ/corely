import express from "express";

const router = express.Router();

router.get("/actions", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html style="color-scheme: dark; background: transparent;">
    <head>
      <meta charset="UTF-8">
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
      <style>
        :root {
          /* Defaults overridden by JS settings fetch */
          --brand-primary: hsl(210, 100%, 65%);
          --brand-primary-bg: hsla(210, 100%, 65%, 0.15);
          --brand-primary-glow: hsla(210, 100%, 65%, 0.4);
          
          --text: #ffffff;
        }
        * { box-sizing: border-box; -webkit-font-smoothing: antialiased; }
        body {
          margin: 0; background: none; font-family: 'JetBrains Mono', monospace;
          display: flex; justify-content: center; align-items:flex-start; /* changed to start to let actions stack */
          height: 100vh; width: 100vw; overflow-x: hidden; overflow-y: auto;
          padding: 20px 0;
        }
        /* Scrollbar styling */
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 10px; }
        
        .container { 
          width: 100%; 
          padding: 0 12px; 
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
          gap: 10px; 
        }
        
        .action-btn {
          display: flex;
          align-items: center;
          gap: 10px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          padding: 10px 12px;
          color: var(--text);
          cursor: pointer;
          transition: all 0.2s ease;
          width: 100%;
          text-align: left;
          font-family: inherit;
        }
        
        .action-btn:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.08); /* Subtle highlight */
          border-color: rgba(255, 255, 255, 0.2); /* Neutral border vs bright flashy glow */
        }
        
        .action-btn:active:not(:disabled) {
          transform: scale(0.98);
        }
        
        .icon-wrapper {
          width: 28px; height: 28px; border-radius: 6px; 
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
          background: var(--brand-primary-bg);
          color: var(--brand-primary);
        }
        
        .icon-wrapper svg {
          width: 16px; height: 16px;
        }
        
        .action-name {
          font-size: 13px;
          font-weight: 700;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        
        /* Grid Layout Overrides */
        body.view-grid .container {
          grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
          gap: 12px;
        }
        body.view-grid .action-btn {
          flex-direction: column;
          justify-content: center;
          text-align: center;
          padding: 18px 10px;
          gap: 12px;
        }
        body.view-grid .icon-wrapper {
          width: 44px; height: 44px; border-radius: 10px;
        }
        body.view-grid .icon-wrapper svg {
          width: 24px; height: 24px;
        }
        body.view-grid .action-name {
          white-space: normal;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          line-height: 1.2;
        }
        
        /* Cooldown State */
        .action-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          border-color: transparent;
        }
      </style>
    </head>
    <body>
      <div class="container" id="actions-container">
        <!-- Actions injected here -->
      </div>

      <script>
        // Load accent settings dynamically
        async function fetchSettings() {
          try {
             const res = await fetch('/api/settings');
             const data = await res.json();
             if (data.accentColor) {
                const hex = data.accentColor;
                document.documentElement.style.setProperty('--brand-primary', hex);
                document.documentElement.style.setProperty('--brand-primary-bg', hex + '26'); // 15% opacity logic fallback
                document.documentElement.style.setProperty('--brand-primary-glow', hex + '66'); // 40% opacity 
             }
             if (data.viewMode === 'grid') {
                document.body.classList.add('view-grid');
             } else {
                document.body.classList.remove('view-grid');
             }
          } catch(e) { console.error("Settings load failed", e); }
        }

        async function fetchActions() {
          try {
            const res = await fetch('/api/actions');
            const actions = await res.json();
            renderActions(actions);
          } catch (err) {
            console.error('Failed to load actions:', err);
          }
        }
        
        function renderActions(actions) {
          const container = document.getElementById('actions-container');
          container.innerHTML = '';
          
          if (actions.length === 0) {
            container.innerHTML = '<div style="color: rgba(255,255,255,0.5); font-size: 12px; text-align: center;">No actions config</div>';
            return;
          }
          
          actions.forEach(action => {
            const btn = document.createElement('button');
            btn.className = 'action-btn';
            btn.onclick = () => executeAction(btn, action);
            
            btn.innerHTML = \`
              <div class="icon-wrapper" id="icon-wrap-\${action.id}">
                 <!-- Icon mounts here -->
              </div>
              <span class="action-name">\${action.name}</span>
            \`;
            
            container.appendChild(btn);

            // Fetch locally cached offline SVG
            fetch(\`/cached-icons/\${action.icon}.svg\`)
              .then(r => r.text())
              .then(svg => {
                 document.getElementById(\`icon-wrap-\${action.id}\`).innerHTML = svg;
              })
              .catch(e => console.error("Missing local icon caching", e));
          });
        }
        
        async function executeAction(btn, action) {
          if (btn.disabled) return;
          
          btn.disabled = true;
          
          try {
            await fetch(\`/api/actions/\${action.id}/execute\`, { method: 'POST' });
          } catch(err) {
            console.error("Execute failed", err);
          }
          
          setTimeout(() => {
            btn.disabled = false;
          }, 3000);
        }

        fetchSettings();
        fetchActions();
      </script>
    </body>
    </html>
  `);
});

export default router;
