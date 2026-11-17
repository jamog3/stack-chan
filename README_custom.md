# README_custom

自分用のメモ。ビルドして stack-chan 実機に反映する方法。

## 前提(環境)

| 項目 | 値 |
|---|---|
| 作業ディレクトリ | `firmware/`(リポジトリ直下に `package.json` はない) |
| Node | `.nvmrc` は 22(動作確認は 24 でも可) |
| Moddable SDK | 10.1.1(`~/.local/share/moddable`、`tools/VERSION` で確認) |
| ESP-IDF | 6.1(`~/.local/share/esp32/esp-idf`、`git describe --tags` が `v6.1`) |
| Python | 3.12(ESP-IDF の Python 環境は `~/.espressif/python_env/idf6.1_py3.12_env`) |
| 実機のポート | `/dev/cu.usbmodem101`(`npm run scan` で確認) |

## 初回だけ

```sh
cd firmware
npm install
```

## ビルドして実機に反映する(ホスト全体)

```sh
cd firmware
npm run flash:m5stackchan_cores3 -- --port=/dev/cu.usbmodem101
```

- ビルド、書き込み、再起動までを行う。初回は数分かかる。
- `--port` を付けないと、ポートの自動検出に失敗することがある。
- 書き込み後に自動でログ表示(シリアルモニタ)に入る。
- ビルドが変なときは、先に `npm run clean`(`firmware/dist` を消す)。

## MOD だけを反映する(速い)

```sh
cd firmware
npm run mod:m5stackchan_cores3 -- mods/your-mod/manifest.json
```

ホストの再ビルドはしない。ホストがすでに実機に入っている前提。

## ログ表示を止める

ログを表示し続けているとき(`flash` のあと、`idf.py monitor` など)は **`Ctrl + ]`** で止める。

止まらないときは、ターミナルのタブを閉じるか、ポートを掴んでいるプロセスを止める。

```sh
lsof /dev/cu.usbmodem101
kill <PID>
```

ポートを掴んだままだと、次の `flash` が失敗するので、書き込み前には止めておく。

## うまくいかないとき

| 症状 | 原因と対処 |
|---|---|
| `st25r3916 ... manifest not found!` | Moddable SDK が古い。SDK を 10.1.1 にする(`cd ~/.local/share/moddable && git checkout 10.1.1`)。そのあと `build/makefiles/mac` で `make` してツールを作り直す |
| `Expected ESP IDF v6.1, found v6.0.2` | ESP-IDF が古い。`cd ~/.local/share/esp32/esp-idf && git fetch --tags && git checkout v6.1 && git submodule update --init --recursive`。そのあと `PATH=/usr/local/bin:$PATH ./install.sh esp32s3`(Python 3.12 で実行する) |
| `ESP-IDF Python virtual environment ... idf6.1_py3.12_env not found` | `install.sh` を別の Python(Homebrew の 3.14 など)で実行した。上と同じく、Python 3.12 を PATH の先頭にして `install.sh` を実行し直す |
| `Failed to find a suitable device` | ポート検出の失敗。`--port=/dev/cu.usbmodem101` を付ける |
| `npm run debug:...` が `Error: not enough keys` | デバッグビルドで XS のキー数が上限を超える。リリースビルド(`flash`)で動かし、必要なら `trace` を足して調べる |
| 起動直後に再起動ループ、`TypeError: call: not a function` | `develop` 取り込み後に起きた。AXP2101 のメソッド名が食い違っていた(`readByte`/`writeByte` ではなく `readUint8`/`writeUint8`)。`794eef89` で修正済み。同じ症状が出たら、取り込みで書き換わらなかった呼び出し側を疑う |

## 実機が認識されない

1. `npm run scan` でデバイスが見えるか確認する。
2. 見えないときは、USB ケーブルを抜き差しする。
3. それでもだめなら、リセットボタンを数秒長押ししてダウンロードモードに入れ、もう一度 `flash` する。
