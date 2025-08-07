import openai
import os
from dotenv import load_dotenv
load_dotenv()

if not os.getenv("OPENAI_API_KEY"):
    raise ValueError("OPENAI_API_KEY not found in environment variables.")

openai.api_key = os.getenv("OPENAI_API_KEY")  # Make sure this environment variable is set

PROMPT_MODE = "summarize"  # Options: "summarize" or "edit"

def read_specific_files(filepaths):
    selected_files = {}
    for filepath in filepaths:
        if filepath.endswith(('.py', '.js', '.html', '.css', '.json')):
            try:
                with open(filepath, 'r', encoding='utf-8') as file:
                    selected_files[filepath] = file.read()
            except Exception as e:
                print(f"Error reading {filepath}: {e}")
    return selected_files

def send_to_openai(files_dict):
    file_summaries = []
    for i, (filepath, content) in enumerate(files_dict.items()):
        print(f"[{i+1}/{len(files_dict)}] Processing {filepath}...")

        if PROMPT_MODE == "edit":
            prompt = f"""You are an expert software engineer. The following is the content of the file {filepath}:

{content[:10000]}

Refactor this code for clarity, performance, and best practices. Return only the complete modified code."""
        else:
            prompt = f"""You are an expert code reviewer. The following is the content of the file {filepath}:

{content[:10000]}

Summarize this file and its purpose."""
        try:
            response = openai.chat.completions.create(
                model="gpt-5",
                messages=[
                    {"role": "system", "content": "You are an expert code reviewer. Summarize the purpose of the code."},
                    {"role": "user", "content": prompt}
                ],
                max_tokens=300,
                temperature=0.3
            )
            summary = response.choices[0].message.content
            file_summaries.append((filepath, summary))
        except Exception as e:
            print(f"OpenAI error with {filepath}: {e}")
    return file_summaries

if __name__ == "__main__":
    # Replace these with the exact files you want to process
    files_to_check = [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "openai_interface.py"),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "routes", "auth.py")
    ]

    files = read_specific_files(files_to_check)
    summaries = send_to_openai(files)

    print("\n--- File Summaries ---\n")
    for path, summary in summaries:
        print(f"{path}:\n{summary}\n{'-'*50}\n")