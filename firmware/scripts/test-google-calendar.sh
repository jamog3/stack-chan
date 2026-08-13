#!/bin/bash
# Google Calendar 予定取得の疎通確認スクリプト
#
# 使い方:
#   1. このファイルを test-google-calendar.local.sh 等の名前でコピーする
#      (このファイル自体に実際の認証情報を書き込んでコミットしないこと)
#   2. コピーした先で下の4つの値を書き換えて実行する
#
# 認証情報の取得手順は docs/google-calendar-reminders_ja.md を参照。
CLIENT_ID="your-client-id"
CLIENT_SECRET="your-client-secret"
REFRESH_TOKEN="your-refresh-token"
CALENDAR_ID="primary"  # 個別カレンダーの場合は「カレンダーの統合」に表示されるIDを指定

echo "1. アクセストークン取得中..."
ACCESS_TOKEN=$(curl -s -X POST https://oauth2.googleapis.com/token \
  -d client_id="$CLIENT_ID" \
  -d client_secret="$CLIENT_SECRET" \
  -d refresh_token="$REFRESH_TOKEN" \
  -d grant_type=refresh_token | tee /tmp/token_response.json | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))")

if [ -z "$ACCESS_TOKEN" ]; then
  echo "アクセストークン取得失敗。レスポンス:"
  cat /tmp/token_response.json
  exit 1
fi
echo "アクセストークン取得成功"

TIME_MIN=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
TIME_MAX=$(date -u -v+24H +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null || date -u -d "+24 hours" +%Y-%m-%dT%H:%M:%S.000Z)

echo "2. 予定取得中 (${TIME_MIN} 〜 ${TIME_MAX})..."
curl -s -G "https://www.googleapis.com/calendar/v3/calendars/$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote('$CALENDAR_ID', safe=''))")/events" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  --data-urlencode "timeMin=$TIME_MIN" \
  --data-urlencode "timeMax=$TIME_MAX" \
  --data-urlencode "singleEvents=true" \
  --data-urlencode "orderBy=startTime" \
  | python3 -m json.tool
