/*
 * クラウド同期の設定（Firebase）
 * 空のままならクラウド同期はオフ（端末の中だけに保存）。
 * 設定のしかたは docs/cloud-sync.md を見てください。
 *
 * apiKey と projectId はブラウザに配る前提の値で、秘密の鍵ではありません。
 * （アクセスの制限は firestore.rules と、APIキーのリファラー制限で行う）
 */
window.EG_CLOUD_CONFIG = {
  apiKey: "",
  projectId: "",
};
