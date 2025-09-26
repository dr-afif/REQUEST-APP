from pathlib import Path
text = Path('tmp_remote.css').read_text()
print('calendar__legend' in text)
