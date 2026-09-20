import io
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from PIL import Image
from worker import compose_alpha, verify_model, subject_context, extract_mask

class TransparencyTests(unittest.TestCase):
    def test_preserves_original_rgb_and_existing_translucency(self):
        original = Image.new("RGBA", (8, 8), (32, 96, 147, 128))
        mask = Image.new("L", (8, 8), 0)
        for x in range(2, 6):
            for y in range(2, 6): mask.putpixel((x, y), 255)
        result = compose_alpha(original, mask)
        self.assertEqual(result.convert("RGB").tobytes(), original.convert("RGB").tobytes())
        self.assertEqual(result.getpixel((3, 3))[3], 128)
        self.assertEqual(result.getpixel((0, 0))[3], 0)
        buffer = io.BytesIO(); result.save(buffer, "PNG")
        restored = Image.open(io.BytesIO(buffer.getvalue()))
        self.assertEqual(restored.mode, "RGBA")
        self.assertEqual(restored.getchannel("A").getextrema(), (0, 128))

    def test_rejects_fake_transparency_and_empty_subject(self):
        original = Image.new("RGBA", (8, 8), "red")
        for mask in (Image.new("L", (8, 8), 255), Image.new("L", (8, 8), 0)):
            with self.assertRaisesRegex(ValueError, "mask_invalid"): compose_alpha(original, mask)

    def test_rejects_mismatched_mask_and_missing_model(self):
        with self.assertRaisesRegex(ValueError, "mask_invalid"): compose_alpha(Image.new("RGB", (8, 8)), Image.new("L", (4, 4)))
        with TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "model_missing"): verify_model(Path(directory))

    def test_context_is_bounded_and_preserves_aspect_ratio_for_large_portraits(self):
        original = Image.new("RGB", (3000, 4000), (240, 220, 190))
        canvas, box = subject_context(original)
        self.assertEqual(canvas.size, (1024, 1024))
        self.assertEqual((box[2]-box[0], box[3]-box[1]), (384, 512))
        self.assertEqual(canvas.getpixel((0, 0)), (240, 220, 190))

    def test_two_scales_retain_fine_detail_and_whole_body_without_repainting(self):
        original = Image.new("RGBA", (512, 512), (40, 150, 170, 180))
        def fake_remove(image, **kwargs):
            self.assertTrue(kwargs['only_mask'])
            self.assertFalse(kwargs['post_process_mask'])
            result = Image.new('L', image.size, 0)
            if image.size == original.size:
                result.paste(255, (180, 80, 320, 220))
                result.putpixel((175, 100), 100)  # a fine fur strand
            else:
                result.paste(240, (436, 336, 576, 656))  # full body in source box
            return result
        mask = extract_mask(original, object(), fake_remove)
        result = compose_alpha(original, mask)
        self.assertEqual(result.convert('RGB').tobytes(), original.convert('RGB').tobytes())
        self.assertEqual(result.getpixel((200, 100))[3], 180)
        self.assertGreater(result.getpixel((200, 350))[3], 160)
        self.assertGreater(result.getpixel((175, 100))[3], 0)
        self.assertEqual(result.getpixel((0, 0))[3], 0)

if __name__ == "__main__": unittest.main()
