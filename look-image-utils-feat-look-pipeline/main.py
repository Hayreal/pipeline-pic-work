import dotenv
from google import genai
import os
dotenv.load_dotenv()


client = genai.Client(
            api_key=os.getenv("GEMINI_API_KEY"),
            http_options={
                "base_url": os.getenv("GEMINI_BASE_URL"),
            }
        )



if __name__ == '__main__':
    prompt = ("Create a picture of a nano banana dish in a fancy restaurant with a Gemini theme")
    response = client.models.generate_content(
        model="gemini-3.1-flash-image-preview",
        contents=[prompt],
    )

    for part in response.parts:
        if part.text is not None:
            print(part.text)
        elif part.inline_data is not None:
            image = part.as_image()
            image.save("generated_image.png")


