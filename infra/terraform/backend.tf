# state は GCS バケットに保存する(ALWAYS ルール)。
# バケット名はコミットしない。初期化のときに渡す:
#   terraform init -backend-config="bucket=<state バケット名>" -backend-config="prefix=mobile-order"
terraform {
  backend "gcs" {}
}
