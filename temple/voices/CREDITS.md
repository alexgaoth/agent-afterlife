# Voice credits

- **Text-to-speech:** FunAudioLLM [Fun-CosyVoice 3.0 0.5B (2512)](https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512), Apache-2.0 weights and [Apache-2.0 code](https://github.com/QwenAudio/CosyVoice/blob/main/LICENSE). Rendered locally on Apple Silicon.
- **Reference prompts:** The same two synthetic Mandarin prompts from the pilot. [Kokoro v1.1-zh](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh) rendered “山中日长，且坐看松间明月，听一夜清风。” with preset `zm_010` for the scholar and `zf_001` for the young woman. Its code and weights are Apache-2.0.
- **Voices:** All audio is synthetic. No human recording was supplied as a reference. The voices do not imitate the historical figures named in the pack. The temple style instruction asked for relaxed, quiet everyday Mandarin.
- **Quality check:** [SenseVoice-Small via sherpa-onnx](https://k2-fsa.github.io/sherpa/onnx/sense-voice/pretrained.html) ran locally. No speech recognition model, reference prompts, or generation scripts ship in the pack.
