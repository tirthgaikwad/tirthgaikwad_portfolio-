import json
with open(r'C:\Users\omkar\.gemini\antigravity-ide\brain\c61adce4-66b7-45e0-a642-dcb34c150e96\.system_generated\logs\transcript_full.jsonl', encoding='utf-8') as f:
    for line in f:
        data = json.loads(line)
        if data.get('type') == 'USER_INPUT':
            content = data.get('content', '')
            if 'add a new option or page in the nav bar named "Saved Profiles"' in content:
                with open(r'c:\Users\omkar\OneDrive\Desktop\Connect2Minds\saved.html', 'w', encoding='utf-8') as out:
                    out.write(content.split('add a new option or page')[0].strip())
                print("Extracted saved.html successfully.")
