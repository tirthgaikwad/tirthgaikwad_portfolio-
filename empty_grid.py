import re
import os

filepath = r'c:\Users\omkar\OneDrive\Desktop\Connect2Minds\saved.html'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# Find the start of the grid
grid_start = content.find('id="profilesGrid"')
if grid_start != -1:
    # Go back to find the <div
    div_start = content.rfind('<div', 0, grid_start)
    # Find the end of the opening tag
    div_end = content.find('>', grid_start) + 1
    
    # Find the pagination strip
    pagination_start = content.find('<!-- Bottom Pagination Strip -->', div_end)
    if pagination_start != -1:
        # The grid closes right before the pagination strip
        # Let's just find the last </div> before pagination_start
        grid_close = content.rfind('</div>', div_end, pagination_start)
        
        # Replace everything between the opening tag and the closing tag
        new_content = content[:div_end] + '\n\n' + content[grid_close:]
        
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print("Successfully removed static cards.")
    else:
        print("Could not find pagination strip.")
else:
    print("Could not find profilesGrid.")
