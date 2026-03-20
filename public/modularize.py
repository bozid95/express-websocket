import sys

with open(r'c:\Project\express-websocket\public\index.html', 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_content = []
# Lines 1-9 (1-indexed)
new_content.extend(lines[0:9])
# Replace 10-269 with CSS link
new_content.append('  <link rel="stylesheet" href="dashboard.css">\n')
# Lines 270-750
new_content.extend(lines[269:750])
# Replace 751-2211 with JS links
new_content.append('  <script src="core.js"></script>\n')
new_content.append('  <script src="home-tab.js"></script>\n')
new_content.append('  <script src="signals-tab.js"></script>\n')
new_content.append('  <script src="insights-tab.js"></script>\n')
new_content.append('  <script src="donations-tab.js"></script>\n')
# Lines 2212-2225
new_content.extend(lines[2211:])

with open(r'c:\Project\express-websocket\public\index.html', 'w', encoding='utf-8') as f:
    f.writelines(new_content)
