# Googleカレンダー予定リマインダー機能

起動時に直近24時間分のGoogleカレンダーの予定を取得し、各予定の開始30分前に
「30分後に予定があります。」と発話する機能。実装は
[`host/modules/calendar/google-calendar.ts`](../host/modules/calendar/google-calendar.ts)、
呼び出し側は
[`host/app/default-behavior/on-context-created.ts`](../host/app/default-behavior/on-context-created.ts)
の「Calendar reminders」セクション。

この機能はOAuth2のリフレッシュトークンで認証する(非公開カレンダーにも対応するため)。
以下はその認証情報 `clientId` / `clientSecret` / `refreshToken` を取得する手順。

## 1. Google Cloud ConsoleでOAuthクライアントを作成

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成(または既存プロジェクトを使用)
2. 「APIとサービス」→「ライブラリ」で **Google Calendar API** を有効化
3. 「APIとサービス」→「認証情報」→「+ 認証情報を作成」→「OAuthクライアントID」
4. アプリケーションの種類は必ず **「ウェブ アプリケーション」** を選ぶ
   - 「デスクトップアプリ」を選ぶと、OAuth Playgroundの固定リダイレクトURIを受け付けられず
     `アクセスをブロック: このアプリのリクエストは無効です` になる
5. 「承認済みのリダイレクトURI」に以下を追加:
   ```
   https://developers.google.com/oauthplayground
   ```
6. 作成後に表示される `client_id` と `client_secret` を控える(後述の通り、これは
   リポジトリにもGitHubにも書かない)

## 2. OAuth同意画面にテストユーザーを追加

公開ステータスが「テスト中」の場合、`calendar.readonly` は機微なスコープ扱いのため、
登録済みのテストユーザーしか認可できない。

1. [OAuth同意画面](https://console.cloud.google.com/apis/credentials/consent) を開く
2. 「テストユーザー」セクションで「+ ADD USERS」
3. 実際にカレンダーを取得したいGoogleアカウントのメールアドレスを追加して保存
   - 未追加のまま進めると `Google の審査プロセスを完了していません` でブロックされる
   - 認可時にブラウザで複数アカウントにログインしていると、意図しないアカウントで
     試して失敗することがあるので要注意

## 3. OAuth Playgroundでリフレッシュトークンを取得

1. [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/) を開く
2. 右上の歯車アイコン →「Use your own OAuth credentials」にチェックし、手順1の
   `client_id` / `client_secret` を入力
3. 左パネルの既存のスコープ選択(チェックボックス)は**すべて解除**する
   - チェックが残っていると `エラー 400: invalid_scope` になることがある
4. 一番上の「Input your own scopes」欄に直接入力:
   ```
   https://www.googleapis.com/auth/calendar.readonly
   ```
5. 「Authorize APIs」をクリックし、手順2で追加したテストユーザーのアカウントでログイン・許可
6. Step 2の画面で「Exchange authorization code for tokens」をクリック
7. 表示される `refresh_token` を控える(これは失効しない限り再利用できる)

## 4. 疎通確認(curl)

[`../scripts/test-google-calendar.sh`](../scripts/test-google-calendar.sh) をコピーして
(このファイル自体は書き換えずに)、コピーした先に取得した
`client_id` / `client_secret` / `refresh_token` / カレンダーID(`primary` または
Googleカレンダーの「カレンダーの統合」に表示されるID)を埋めて実行し、
直近24時間の予定JSONが返ってくることを確認する。

**認証情報を埋めたファイルはコミットしないこと。** リポジトリの `.gitignore` で
`test-google-calendar.local.sh` のような命名は除外されるので、そのファイル名で
保存するとよい。

## 5. デバイスへの設定

認証情報はコード/manifestに書かず、デバイスの `Preference` に直接書き込む
(`DOMAIN.ai` の `token` などと同じ扱い):

```js
Preference.set('calendar', 'clientId', '...')
Preference.set('calendar', 'clientSecret', '...')
Preference.set('calendar', 'refreshToken', '...')
Preference.set('calendar', 'calendarIds', 'primary,xxxxx@group.calendar.google.com') // カンマ区切りで複数可
```

## トラブルシューティング早見表

| エラー | 原因 | 対処 |
|---|---|---|
| アクセスをブロック: このアプリのリクエストは無効です | OAuthクライアントが「デスクトップアプリ」種別 | 「ウェブ アプリケーション」で作り直し、リダイレクトURIを登録 |
| Google の審査プロセスを完了していません | 認可アカウントがテストユーザー未登録 | OAuth同意画面にテストユーザーとして追加 |
| エラー 400: invalid_scope | Playground左パネルの古いスコープ選択が混入 | 全チェック解除し、上部の入力欄にスコープを直接手入力 |
