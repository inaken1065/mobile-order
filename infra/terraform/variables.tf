variable "project_id" {
  description = "Google Cloud のプロジェクト ID"
  type        = string
}

variable "region" {
  description = "リージョン(無料枠の対象は us-central1 など)"
  type        = string
  default     = "us-central1"
}

variable "zone" {
  description = "ゾーン"
  type        = string
  default     = "us-central1-a"
}

variable "allowed_ip_cidr" {
  description = "80 番を許可する所有者の IP(CIDR。例: 203.0.113.10/32)。0.0.0.0/0 は許さない"
  type        = string

  validation {
    condition     = can(cidrhost(var.allowed_ip_cidr, 0)) && var.allowed_ip_cidr != "0.0.0.0/0"
    error_message = "allowed_ip_cidr は CIDR 形式で、0.0.0.0/0 以外にしてください。"
  }
}

variable "github_repository" {
  description = "WIF で許可する GitHub のリポジトリ(owner/repo)"
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "github_repository は owner/repo の形式にしてください。"
  }
}

variable "owner_email" {
  description = "所有者の Google アカウントのメール(手動の復旧のための IAP と OS Login の権限を付ける)"
  type        = string
}

variable "node_version" {
  description = "VM に入れる Node.js の版(24 系。例: 24.0.0 の形式)"
  type        = string

  validation {
    condition     = can(regex("^24\\.[0-9]+\\.[0-9]+$", var.node_version))
    error_message = "node_version は 24.x.y の形式にしてください。"
  }
}

variable "node_sha256" {
  description = "node-v<版>-linux-x64.tar.xz の SHA-256(公式の SHASUMS256.txt の値)"
  type        = string

  validation {
    condition     = can(regex("^[0-9a-f]{64}$", var.node_sha256))
    error_message = "node_sha256 は 64 桁の小文字の 16 進にしてください。"
  }
}
