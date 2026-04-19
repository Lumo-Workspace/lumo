#!/usr/bin/env node
/**
 * One-off script: translate Inbox i18n keys into 11 locales.
 * Run: node scripts/translate-inbox-keys.js
 */

const fs = require('fs')
const path = require('path')

const I18N_DIR = path.join(__dirname, '..', 'lib', 'i18n')

// Translations map: locale -> key -> value
const translations = {
  de: {
    'common.retry': 'Erneut versuchen',
    'inbox.markAllRead': 'Alle als gelesen markieren',
    'inbox.section.actionable': 'Ihre Antwort erforderlich',
    'inbox.section.other': 'Sonstige',
    'inbox.empty.allCaughtUp': 'Sie sind auf dem neuesten Stand',
    'inbox.noLinkedTask':
      'Keine Aufgabe mit dieser Benachrichtigung verknüpft.',
    'inbox.unreadCount':
      '{count, plural, one {# ungelesene Benachrichtigung} other {# ungelesene Benachrichtigungen}}',
    'notification.verb.taskInReview': 'zur Überprüfung eingereicht',
    'notification.verb.taskSentBack': 'zurück auf „In Bearbeitung" gesetzt',
    'notification.verb.taskAssigned': 'Ihnen zugewiesen',
    'notification.verb.taskSpecReady':
      'einen Spezifikationsentwurf erstellt für',
    'notification.verb.taskMentioned': 'Sie erwähnt in',
    'notification.verb.agentClarify': 'hat eine Frage zu',
    'notification.verb.agentAuthorize': 'benötigt Ihre Genehmigung für',
    'notification.verb.agentVerify': 'Arbeit abgeschlossen an',
    'notification.verb.agentFailed': 'fehlgeschlagen bei',
    'notification.verb.agentDone': 'Arbeit beendet an',
    'notification.defaultActor': 'Lumo AI',
    'notification.unspecifiedTask': 'einer Aufgabe',
    'notification.action.done': 'Erledigt',
    'notification.action.sendBack': 'Zurückschicken',
    'notification.menu.markRead': 'Als gelesen markieren',
    'notification.menu.markUnread': 'Als ungelesen markieren',
    'notification.menu.delete': 'Benachrichtigung löschen',
    'agent.clarify.placeholder': 'Agent antworten...',
    'agent.clarify.send': 'Antwort senden',
    'agent.verify.confirm': 'Bestätigen',
    'agent.authorize.approve': 'Genehmigen',
    'agent.authorize.deny': 'Ablehnen',
  },

  fr: {
    'common.retry': 'Réessayer',
    'inbox.markAllRead': 'Tout marquer comme lu',
    'inbox.section.actionable': 'Nécessite votre réponse',
    'inbox.section.other': 'Autre',
    'inbox.empty.allCaughtUp': 'Vous êtes à jour',
    'inbox.noLinkedTask': 'Aucune tâche liée à cette notification.',
    'inbox.unreadCount':
      '{count, plural, one {# notification non lue} other {# notifications non lues}}',
    'notification.verb.taskInReview': 'soumis pour révision',
    'notification.verb.taskSentBack': 'renvoyé en cours',
    'notification.verb.taskAssigned': 'vous a assigné à',
    'notification.verb.taskSpecReady': 'a généré un brouillon de spec pour',
    'notification.verb.taskMentioned': 'vous a mentionné dans',
    'notification.verb.agentClarify': 'a une question sur',
    'notification.verb.agentAuthorize': 'a besoin de votre approbation pour',
    'notification.verb.agentVerify': 'a terminé le travail sur',
    'notification.verb.agentFailed': 'a échoué sur',
    'notification.verb.agentDone': 'a terminé le travail sur',
    'notification.defaultActor': 'Lumo AI',
    'notification.unspecifiedTask': 'une tâche',
    'notification.action.done': 'Terminé',
    'notification.action.sendBack': 'Renvoyer',
    'notification.menu.markRead': 'Marquer comme lu',
    'notification.menu.markUnread': 'Marquer comme non lu',
    'notification.menu.delete': 'Supprimer la notification',
    'agent.clarify.placeholder': "Répondre à l'agent…",
    'agent.clarify.send': 'Envoyer la réponse',
    'agent.verify.confirm': 'Confirmer',
    'agent.authorize.approve': 'Approuver',
    'agent.authorize.deny': 'Refuser',
  },

  es: {
    'common.retry': 'Reintentar',
    'inbox.markAllRead': 'Marcar todo como leído',
    'inbox.section.actionable': 'Requiere tu respuesta',
    'inbox.section.other': 'Otras',
    'inbox.empty.allCaughtUp': 'Estás al día',
    'inbox.noLinkedTask': 'No hay ninguna tarea vinculada a esta notificación.',
    'inbox.unreadCount':
      '{count, plural, one {# notificación no leída} other {# notificaciones no leídas}}',
    'notification.verb.taskInReview': 'enviado para revisión',
    'notification.verb.taskSentBack': 'devuelto a En progreso',
    'notification.verb.taskAssigned': 'te ha asignado a',
    'notification.verb.taskSpecReady':
      'ha generado un borrador de especificación para',
    'notification.verb.taskMentioned': 'te ha mencionado en',
    'notification.verb.agentClarify': 'tiene una pregunta sobre',
    'notification.verb.agentAuthorize': 'necesita tu aprobación para',
    'notification.verb.agentVerify': 'ha completado el trabajo en',
    'notification.verb.agentFailed': 'ha fallado en',
    'notification.verb.agentDone': 'ha terminado el trabajo en',
    'notification.defaultActor': 'Lumo AI',
    'notification.unspecifiedTask': 'una tarea',
    'notification.action.done': 'Listo',
    'notification.action.sendBack': 'Devolver',
    'notification.menu.markRead': 'Marcar como leído',
    'notification.menu.markUnread': 'Marcar como no leído',
    'notification.menu.delete': 'Eliminar notificación',
    'agent.clarify.placeholder': 'Responder al agente…',
    'agent.clarify.send': 'Enviar respuesta',
    'agent.verify.confirm': 'Confirmar',
    'agent.authorize.approve': 'Aprobar',
    'agent.authorize.deny': 'Rechazar',
  },

  'es-419': {
    'common.retry': 'Reintentar',
    'inbox.markAllRead': 'Marcar todo como leído',
    'inbox.section.actionable': 'Requiere tu respuesta',
    'inbox.section.other': 'Otras',
    'inbox.empty.allCaughtUp': 'Estás al día',
    'inbox.noLinkedTask': 'No hay ninguna tarea vinculada a esta notificación.',
    'inbox.unreadCount':
      '{count, plural, one {# notificación sin leer} other {# notificaciones sin leer}}',
    'notification.verb.taskInReview': 'enviado para revisión',
    'notification.verb.taskSentBack': 'devuelto a En progreso',
    'notification.verb.taskAssigned': 'te asignó a',
    'notification.verb.taskSpecReady':
      'generó un borrador de especificación para',
    'notification.verb.taskMentioned': 'te mencionó en',
    'notification.verb.agentClarify': 'tiene una pregunta sobre',
    'notification.verb.agentAuthorize': 'necesita tu aprobación para',
    'notification.verb.agentVerify': 'completó el trabajo en',
    'notification.verb.agentFailed': 'falló en',
    'notification.verb.agentDone': 'terminó el trabajo en',
    'notification.defaultActor': 'Lumo AI',
    'notification.unspecifiedTask': 'una tarea',
    'notification.action.done': 'Listo',
    'notification.action.sendBack': 'Devolver',
    'notification.menu.markRead': 'Marcar como leído',
    'notification.menu.markUnread': 'Marcar como no leído',
    'notification.menu.delete': 'Eliminar notificación',
    'agent.clarify.placeholder': 'Responder al agente…',
    'agent.clarify.send': 'Enviar respuesta',
    'agent.verify.confirm': 'Confirmar',
    'agent.authorize.approve': 'Aprobar',
    'agent.authorize.deny': 'Rechazar',
  },

  ja: {
    'common.retry': '再試行',
    'inbox.markAllRead': 'すべて既読にする',
    'inbox.section.actionable': '対応が必要',
    'inbox.section.other': 'その他',
    'inbox.empty.allCaughtUp': '未読はありません',
    'inbox.noLinkedTask': 'この通知に紐づくタスクはありません。',
    'inbox.unreadCount': '{count, plural, other {# 件の未読通知}}',
    'notification.verb.taskInReview': 'レビュー依頼を送信しました',
    'notification.verb.taskSentBack': '進行中に差し戻しました',
    'notification.verb.taskAssigned': 'をあなたに割り当てました',
    'notification.verb.taskSpecReady': 'の仕様書ドラフトを生成しました',
    'notification.verb.taskMentioned': 'であなたをメンションしました',
    'notification.verb.agentClarify': 'について質問があります',
    'notification.verb.agentAuthorize': 'の承認が必要です',
    'notification.verb.agentVerify': 'の作業が完了しました',
    'notification.verb.agentFailed': 'で失敗しました',
    'notification.verb.agentDone': 'の作業を終了しました',
    'notification.defaultActor': 'Lumo AI',
    'notification.unspecifiedTask': 'タスク',
    'notification.action.done': '完了',
    'notification.action.sendBack': '差し戻す',
    'notification.menu.markRead': '既読にする',
    'notification.menu.markUnread': '未読にする',
    'notification.menu.delete': '通知を削除',
    'agent.clarify.placeholder': 'エージェントに返信…',
    'agent.clarify.send': '返信を送信',
    'agent.verify.confirm': '確認',
    'agent.authorize.approve': '承認',
    'agent.authorize.deny': '拒否',
  },

  ko: {
    'common.retry': '다시 시도',
    'inbox.markAllRead': '모두 읽음으로 표시',
    'inbox.section.actionable': '응답이 필요합니다',
    'inbox.section.other': '기타',
    'inbox.empty.allCaughtUp': '모두 확인했습니다',
    'inbox.noLinkedTask': '이 알림에 연결된 작업이 없습니다.',
    'inbox.unreadCount': '{count, plural, other {읽지 않은 알림 #개}}',
    'notification.verb.taskInReview': '검토 요청을 제출했습니다',
    'notification.verb.taskSentBack': '진행 중으로 되돌렸습니다',
    'notification.verb.taskAssigned': '님을 할당했습니다',
    'notification.verb.taskSpecReady': '의 사양 초안을 생성했습니다',
    'notification.verb.taskMentioned': '에서 회원님을 언급했습니다',
    'notification.verb.agentClarify': '에 대해 질문이 있습니다',
    'notification.verb.agentAuthorize': '에 대한 승인이 필요합니다',
    'notification.verb.agentVerify': '작업을 완료했습니다',
    'notification.verb.agentFailed': '에서 실패했습니다',
    'notification.verb.agentDone': '작업을 마쳤습니다',
    'notification.defaultActor': 'Lumo AI',
    'notification.unspecifiedTask': '작업',
    'notification.action.done': '완료',
    'notification.action.sendBack': '되돌리기',
    'notification.menu.markRead': '읽음으로 표시',
    'notification.menu.markUnread': '읽지 않음으로 표시',
    'notification.menu.delete': '알림 삭제',
    'agent.clarify.placeholder': '에이전트에게 답장…',
    'agent.clarify.send': '답장 보내기',
    'agent.verify.confirm': '확인',
    'agent.authorize.approve': '승인',
    'agent.authorize.deny': '거부',
  },

  hi: {
    'common.retry': 'पुनः प्रयास करें',
    'inbox.markAllRead': 'सभी को पढ़ा हुआ चिह्नित करें',
    'inbox.section.actionable': 'आपके उत्तर की आवश्यकता है',
    'inbox.section.other': 'अन्य',
    'inbox.empty.allCaughtUp': 'सब कुछ पढ़ लिया गया है',
    'inbox.noLinkedTask': 'इस सूचना से कोई कार्य नहीं जुड़ा है।',
    'inbox.unreadCount':
      '{count, plural, one {# अपठित सूचना} other {# अपठित सूचनाएं}}',
    'notification.verb.taskInReview': 'समीक्षा के लिए सबमिट किया',
    'notification.verb.taskSentBack': 'प्रगति में वापस भेजा',
    'notification.verb.taskAssigned': 'आपको सौंपा',
    'notification.verb.taskSpecReady': 'के लिए एक स्पेक ड्राफ़्ट तैयार किया',
    'notification.verb.taskMentioned': 'में आपका उल्लेख किया',
    'notification.verb.agentClarify': 'के बारे में एक प्रश्न है',
    'notification.verb.agentAuthorize': 'के लिए आपकी स्वीकृति आवश्यक है',
    'notification.verb.agentVerify': 'पर कार्य पूर्ण किया',
    'notification.verb.agentFailed': 'पर विफल हुआ',
    'notification.verb.agentDone': 'पर कार्य समाप्त किया',
    'notification.defaultActor': 'Lumo AI',
    'notification.unspecifiedTask': 'एक कार्य',
    'notification.action.done': 'हो गया',
    'notification.action.sendBack': 'वापस भेजें',
    'notification.menu.markRead': 'पढ़ा हुआ चिह्नित करें',
    'notification.menu.markUnread': 'अपठित चिह्नित करें',
    'notification.menu.delete': 'सूचना हटाएं',
    'agent.clarify.placeholder': 'एजेंट को उत्तर दें…',
    'agent.clarify.send': 'उत्तर भेजें',
    'agent.verify.confirm': 'पुष्टि करें',
    'agent.authorize.approve': 'स्वीकृत करें',
    'agent.authorize.deny': 'अस्वीकार करें',
  },

  ru: {
    'common.retry': 'Повторить',
    'inbox.markAllRead': 'Отметить все как прочитанные',
    'inbox.section.actionable': 'Требует вашего ответа',
    'inbox.section.other': 'Прочее',
    'inbox.empty.allCaughtUp': 'Вы всё прочитали',
    'inbox.noLinkedTask': 'Задача не привязана к этому уведомлению.',
    'inbox.unreadCount':
      '{count, plural, one {# непрочитанное уведомление} few {# непрочитанных уведомления} many {# непрочитанных уведомлений} other {# непрочитанных уведомления}}',
    'notification.verb.taskInReview': 'отправлено на проверку',
    'notification.verb.taskSentBack': 'возвращено в работу',
    'notification.verb.taskAssigned': 'назначил вас на',
    'notification.verb.taskSpecReady': 'сгенерировал черновик спецификации для',
    'notification.verb.taskMentioned': 'упомянул вас в',
    'notification.verb.agentClarify': 'задал вопрос о',
    'notification.verb.agentAuthorize': 'требует вашего одобрения для',
    'notification.verb.agentVerify': 'завершил работу над',
    'notification.verb.agentFailed': 'завершился с ошибкой на',
    'notification.verb.agentDone': 'завершил работу над',
    'notification.defaultActor': 'Lumo AI',
    'notification.unspecifiedTask': 'задачей',
    'notification.action.done': 'Готово',
    'notification.action.sendBack': 'Вернуть',
    'notification.menu.markRead': 'Отметить как прочитанное',
    'notification.menu.markUnread': 'Отметить как непрочитанное',
    'notification.menu.delete': 'Удалить уведомление',
    'agent.clarify.placeholder': 'Ответить агенту…',
    'agent.clarify.send': 'Отправить ответ',
    'agent.verify.confirm': 'Подтвердить',
    'agent.authorize.approve': 'Одобрить',
    'agent.authorize.deny': 'Отклонить',
  },

  vi: {
    'common.retry': 'Thử lại',
    'inbox.markAllRead': 'Đánh dấu tất cả đã đọc',
    'inbox.section.actionable': 'Cần phản hồi của bạn',
    'inbox.section.other': 'Khác',
    'inbox.empty.allCaughtUp': 'Bạn đã đọc hết thông báo',
    'inbox.noLinkedTask':
      'Không có tác vụ nào được liên kết với thông báo này.',
    'inbox.unreadCount': '{count, plural, other {# thông báo chưa đọc}}',
    'notification.verb.taskInReview': 'đã gửi để xem xét',
    'notification.verb.taskSentBack': 'đã trả về Đang thực hiện',
    'notification.verb.taskAssigned': 'đã giao cho bạn',
    'notification.verb.taskSpecReady': 'đã tạo bản nháp đặc tả cho',
    'notification.verb.taskMentioned': 'đã đề cập bạn trong',
    'notification.verb.agentClarify': 'có câu hỏi về',
    'notification.verb.agentAuthorize': 'cần bạn phê duyệt cho',
    'notification.verb.agentVerify': 'đã hoàn thành công việc trên',
    'notification.verb.agentFailed': 'gặp lỗi tại',
    'notification.verb.agentDone': 'đã kết thúc công việc trên',
    'notification.defaultActor': 'Lumo AI',
    'notification.unspecifiedTask': 'một tác vụ',
    'notification.action.done': 'Xong',
    'notification.action.sendBack': 'Gửi lại',
    'notification.menu.markRead': 'Đánh dấu đã đọc',
    'notification.menu.markUnread': 'Đánh dấu chưa đọc',
    'notification.menu.delete': 'Xóa thông báo',
    'agent.clarify.placeholder': 'Trả lời tác nhân…',
    'agent.clarify.send': 'Gửi phản hồi',
    'agent.verify.confirm': 'Xác nhận',
    'agent.authorize.approve': 'Chấp thuận',
    'agent.authorize.deny': 'Từ chối',
  },

  id: {
    'common.retry': 'Coba lagi',
    'inbox.markAllRead': 'Tandai semua sudah dibaca',
    'inbox.section.actionable': 'Perlu respons Anda',
    'inbox.section.other': 'Lainnya',
    'inbox.empty.allCaughtUp': 'Semua sudah terbaca',
    'inbox.noLinkedTask': 'Tidak ada tugas yang ditautkan ke notifikasi ini.',
    'inbox.unreadCount': '{count, plural, other {# notifikasi belum dibaca}}',
    'notification.verb.taskInReview': 'dikirim untuk ditinjau',
    'notification.verb.taskSentBack': 'dikembalikan ke Sedang Dikerjakan',
    'notification.verb.taskAssigned': 'menugaskan Anda ke',
    'notification.verb.taskSpecReady': 'membuat draf spesifikasi untuk',
    'notification.verb.taskMentioned': 'menyebut Anda di',
    'notification.verb.agentClarify': 'memiliki pertanyaan tentang',
    'notification.verb.agentAuthorize': 'membutuhkan persetujuan Anda untuk',
    'notification.verb.agentVerify': 'menyelesaikan pekerjaan di',
    'notification.verb.agentFailed': 'gagal pada',
    'notification.verb.agentDone': 'menyelesaikan pekerjaan di',
    'notification.defaultActor': 'Lumo AI',
    'notification.unspecifiedTask': 'sebuah tugas',
    'notification.action.done': 'Selesai',
    'notification.action.sendBack': 'Kembalikan',
    'notification.menu.markRead': 'Tandai sudah dibaca',
    'notification.menu.markUnread': 'Tandai belum dibaca',
    'notification.menu.delete': 'Hapus notifikasi',
    'agent.clarify.placeholder': 'Balas agen…',
    'agent.clarify.send': 'Kirim balasan',
    'agent.verify.confirm': 'Konfirmasi',
    'agent.authorize.approve': 'Setujui',
    'agent.authorize.deny': 'Tolak',
  },

  ms: {
    'common.retry': 'Cuba semula',
    'inbox.markAllRead': 'Tandakan semua sebagai dibaca',
    'inbox.section.actionable': 'Memerlukan respons anda',
    'inbox.section.other': 'Lain-lain',
    'inbox.empty.allCaughtUp': 'Semua sudah dibaca',
    'inbox.noLinkedTask':
      'Tiada tugas yang dikaitkan dengan pemberitahuan ini.',
    'inbox.unreadCount':
      '{count, plural, other {# pemberitahuan belum dibaca}}',
    'notification.verb.taskInReview': 'dihantar untuk semakan',
    'notification.verb.taskSentBack': 'dikembalikan ke Sedang Dijalankan',
    'notification.verb.taskAssigned': 'menugaskan anda ke',
    'notification.verb.taskSpecReady': 'menjana draf spesifikasi untuk',
    'notification.verb.taskMentioned': 'menyebut anda dalam',
    'notification.verb.agentClarify': 'mempunyai soalan tentang',
    'notification.verb.agentAuthorize': 'memerlukan kelulusan anda untuk',
    'notification.verb.agentVerify': 'telah menyelesaikan kerja pada',
    'notification.verb.agentFailed': 'gagal pada',
    'notification.verb.agentDone': 'telah selesai bekerja pada',
    'notification.defaultActor': 'Lumo AI',
    'notification.unspecifiedTask': 'satu tugas',
    'notification.action.done': 'Selesai',
    'notification.action.sendBack': 'Hantar balik',
    'notification.menu.markRead': 'Tandakan sebagai dibaca',
    'notification.menu.markUnread': 'Tandakan sebagai belum dibaca',
    'notification.menu.delete': 'Padam pemberitahuan',
    'agent.clarify.placeholder': 'Balas agen…',
    'agent.clarify.send': 'Hantar balasan',
    'agent.verify.confirm': 'Sahkan',
    'agent.authorize.approve': 'Luluskan',
    'agent.authorize.deny': 'Tolak',
  },
}

const KEYS_TO_UPDATE = [
  'common.retry',
  'inbox.markAllRead',
  'inbox.section.actionable',
  'inbox.section.other',
  'inbox.empty.allCaughtUp',
  'inbox.noLinkedTask',
  'inbox.unreadCount',
  'notification.verb.taskInReview',
  'notification.verb.taskSentBack',
  'notification.verb.taskAssigned',
  'notification.verb.taskSpecReady',
  'notification.verb.taskMentioned',
  'notification.verb.agentClarify',
  'notification.verb.agentAuthorize',
  'notification.verb.agentVerify',
  'notification.verb.agentFailed',
  'notification.verb.agentDone',
  'notification.defaultActor',
  'notification.unspecifiedTask',
  'notification.action.done',
  'notification.action.sendBack',
  'notification.menu.markRead',
  'notification.menu.markUnread',
  'notification.menu.delete',
  'agent.clarify.placeholder',
  'agent.clarify.send',
  'agent.verify.confirm',
  'agent.authorize.approve',
  'agent.authorize.deny',
]

let hadError = false

for (const [locale, localeTranslations] of Object.entries(translations)) {
  const filePath = path.join(I18N_DIR, `${locale}.json`)

  let data
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (e) {
    console.error(`ERROR reading ${filePath}: ${e.message}`)
    hadError = true
    continue
  }

  // Check all expected keys exist in the translation map
  for (const key of KEYS_TO_UPDATE) {
    if (!(key in localeTranslations)) {
      console.error(
        `ERROR: Missing translation for key "${key}" in locale "${locale}"`
      )
      hadError = true
    }
  }

  // Apply translations
  for (const [key, value] of Object.entries(localeTranslations)) {
    data[key] = value
  }

  // Write back
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8')
    console.log(`✓ ${locale}.json updated`)
  } catch (e) {
    console.error(`ERROR writing ${filePath}: ${e.message}`)
    hadError = true
  }
}

if (hadError) {
  console.error('\nCompleted with errors.')
  process.exit(1)
} else {
  console.log('\nAll locale files updated successfully.')
}
