# Obsidian AI History Importer

ChatGPT / Claude のエクスポートを、Obsidian のノートとして取り込むプラグインです。会話ごとに 1 つの Markdown ファイルを作成し、添付ファイルも一緒に保存します。

## できること

- ChatGPT / Claude の会話を取り込み（ChatGPT の分割エクスポートにも対応）
- 会話ごとに 1 つのノートを作成し、完全な会話IDとサービス名で取り込み済みノートを識別
- 音声文字起こし、メッセージ内の画像・音声参照、添付メタデータを取り込み
- 添付ファイルをバイナリ照合して安全に保存。同名の別添付や既存のユーザーファイルを上書きしない
- 選択中の分岐だけ、または全分岐を取り込み（設定で選択）
- テンプレートでノートの見た目をカスタマイズ

## 使い方

1. ChatGPT または Claude のエクスポートZIPを展開します。会話JSONと添付の `.dat` ファイルを同じエクスポートフォルダに残してください。ChatGPTは単一の会話JSON、またはマニフェストと分割された会話JSONに対応します。ZIPを直接指定する機能ではありません。
2. Obsidian の **設定 → コミュニティプラグイン** で本プラグインを有効化します。
3. 設定画面で以下を指定します。
    - **Export directory**: エクスポートしたフォルダのパス
    - **ChatGPT notes directory**: ChatGPT ノートの保存先（Vault 内）
    - **Claude notes directory**: Claude ノートの保存先（Vault 内）
    - **Attachments directory**: 添付ファイルの保存先（Vault 内）
    - **Custom template path**（任意）: テンプレートファイルのパス
4. コマンドパレットで **Import ChatGPT history** または **Import Claude history** を実行します。

## 取り込み対象

- 会話: 単一の `conversations.json` または `conversations-000.json` などの分割ファイル。マニフェストがあればその一覧を使用します。
- 添付: メッセージの添付一覧と `asset_pointer` を統合し、エクスポート中の実ファイルをIDで対応付けます。画像名対応表の元名・ライブラリメタデータのMIME型も使用します。
- ライブラリ: 会話ID・発言IDの両方が一致するファイルだけ、その発言の添付として補完します。出所不明ファイルを別の会話に推測で関連付けません。
- 対象外: 会話に結び付かない独立したライブラリ全体、Codex・Sora・買い物履歴など。会話インポーターはエクスポートZIP全体の完全バックアップではありません。

### 分岐とフィルター

**Include all conversation branches** がオフ（初期値）の場合、選択中の `current_node` の親をたどった分岐だけを取り込みます。オンの場合は他の応答・編集前の質問も取り込み、各発言にノードID・親ID・現在/代替分岐を記載します。カスタムテンプレートでは `message.metadata.nodeId` / `parentNodeId` / `branch` を使用できます。

全分岐を選んでも、システム・隠し発言・思考過程・ツール入力JSON・思考時間の各設定は独立して適用されます。フィルターをオフにするとそれらの取り込み範囲を広げられます。ユーザー編集コンテキストは取り込みません。思考時間除外は `reasoning_recap` と、アシスタントの時間表記だけの発言を対象とし、ユーザーが引用した表記や本文付きの説明を削除しません。

## よくある質問

### 取り込み済みの会話はどうなりますか？

- **Overwrite on reimport** がオフ: 既存ノートはスキップされます。
- **Overwrite on reimport** がオン: 同じサービス・会話IDの既存ノートを更新します。手動で改名したノートや旧バージョンの短いファイル名はそのまま使います。
- 同じファイル名でも会話IDが異なるノートや個人ノートは上書きしません。新規ノートは完全なIDを用いた安全な名前で保存します。
- ファイル名はUnicode正規化、UTF-8の長さ制限、Windowsの予約名、リンクに使えない記号、未割り当てUnicode文字などを安全化します。元タイトルは本文に保持します。
- スキップ時には添付をコピーしません。更新時は既存添付とバイナリ照合し、一致すれば再利用、異なれば別ファイルを保存します。既存の添付や旧名のファイルは削除しません。
- 旧バージョンからの初回更新では、旧添付を残したままID付きの安全な名前へコピーしてリンクを更新するため、添付保存量が増えることがあります。それ以降の同一データの再取り込みでは増えません。

### 添付ファイルはどこに保存されますか？

設定した **Attachments directory** に保存されます。画像は `![[...]]`、その他は `[[...]]` のリンクでノートに挿入されます。
Claude のエクスポートには添付ファイルが含まれないため、Claude 取り込みでは添付ファイルは作成されません。

## テンプレート

テンプレートを使うと、ノートの構成を自由に変更できます。**Custom template path** は Vault からの相対パスで指定してください（例: `Templates/chatgpt.md`）。テンプレートは Nunjucks 形式です。

`ai_source` / `ai_conversation_id` / `ai_import_key` は再取り込みに必須の管理用メタデータです。カスタムテンプレートに書かれていなくても先頭のfrontmatterへ自動付与され、書かれている場合も実際の会話IDで更新されます。

### デフォルトテンプレートの内容

デフォルトでは以下の内容が出力されます。

- Frontmatter: `ai_source`, `ai_conversation_id`, `ai_import_key`, `created_at`, `updated_at`
- 見出し: 会話タイトル
- 各メッセージをロールごとに見出し化して本文を出力
- 添付ファイルがあれば `Attachments` セクションにリンクを列挙

### カスタムテンプレートの書き方

テンプレートでは `conversation` とその中の `messages` / `attachments` を参照できます。

主なフィールド:

- `conversation.source`
- `conversation.conversationId`
- `conversation.importKey`
- `conversation.title`
- `conversation.createdAt`, `conversation.updatedAt`
- `conversation.messages`（配列）
    - `message.role`, `message.createdAt`, `message.content`, `message.contentType`
    - `message.attachments`（配列）
        - `attachment.id`, `attachment.name`, `attachment.mimeType`
        - `attachment.sizeBytes`, `attachment.vaultPath`, `attachment.obsidianLink`

利用できるフィルタ:

- `roleTitle`（例: `{{ message.role | roleTitle }}`）

最小テンプレート例:

```nunjucks
---
ai_source: "{{ conversation.source }}"
ai_conversation_id: "{{ conversation.conversationId }}"
---

# {{ conversation.title }}

{% for message in conversation.messages %}
## {{ message.role | roleTitle }}

{{ message.content | trim }}
{% endfor %}
```

## 注意点

- 単一または分割された会話JSONと、参照先の添付実体が必要です。元エクスポートに実体が存在しないファイルは復元できません。対応付け不能・複数候補の添付は警告として通知し、IDをノートに残します。
- エクスポートにツール宛先情報がない場合、通常のJSON回答と区別できない内容を推測で削除しません。
- 生成物への `sandbox:` リンク自体の書き換えは行いません。対応する実ファイルが添付として復元できた場合は添付セクションにローカルリンクを追加します。
- 独立したライブラリや対象外サービスのデータも含めた原本保管には、元ZIPを別途保存してください。
- 大量の履歴を取り込む場合、処理に時間がかかることがあります。並行した取り込みは同じプラグインから開始できません。

## 開発・検証

```bash
pnpm test
pnpm lint
pnpm build
pnpm --filter plugin exec tsc --noEmit -p tsconfig.json
```

実エクスポートを使った検証には[検証スクリプト](scripts/verify-export.mjs)を使用できます。既存のエクスポート・元Vaultは読み取り専用で扱います。出力先は新規または空のディレクトリに限定されます。初回取り込み、上書き再取り込み、スキップ再取り込みの3回を実行し、後2回でファイルやバイト列が増減しないこと、文字起こし・画像参照・添付ハッシュ・リンク存在を確認します。

```bash
node scripts/verify-export.mjs --export /path/to/extracted-export --output /path/to/new-verification-vault
```

`--all-branches` で全分岐を検証できます。`--seed /path/to/existing-vault` を付けると、元Vaultを変更せず、既存のノートと添付を出力先へコピーして旧バージョンからの移行も検証します。検証用の固定設定は思考過程・思考時間・ツール入力除外です。結果は出力先の `verification-result.json` に保存されます。
