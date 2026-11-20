# Public Sans

`PublicSans-Variable.woff2` is Public Sans by the U.S. Web Design System, from release
[v2.001](https://github.com/uswds/public-sans/releases/tag/v2.001) (`public-sans-v2.001.zip`), under the SIL Open
Font License 1.1 (`OFL.txt`). The licence names no Reserved Font Name.

The release ships the variable font only as a TrueType file covering weights 100 to 900. This copy is that file,
`fonts/variable/PublicSans[wght].ttf`, limited to weights 400 to 700 and compressed to WOFF2 with
[fontTools](https://github.com/fonttools/fonttools) 4.68. No glyph is removed: Public Sans covers Latin scripts only.

```sh
pip install 'fonttools[woff]'
fonttools varLib.instancer 'PublicSans[wght].ttf' wght=400:700 --update-name-table -o PublicSans-400-700.ttf
fonttools ttLib.woff2 compress -o PublicSans-Variable.woff2 PublicSans-400-700.ttf
```
