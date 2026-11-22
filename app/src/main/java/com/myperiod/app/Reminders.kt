package com.myperiod.app

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONArray
import org.json.JSONObject

private const val CHANNEL = "reminders"
private const val PREFS = "reminders"
private const val KEY = "events"

object Reminders {

    fun ensureChannel(ctx: Context) {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL, "التذكيرات", NotificationManager.IMPORTANCE_DEFAULT)
            )
        }
    }

    private fun pending(ctx: Context, id: Int, title: String, text: String): PendingIntent {
        val i = Intent(ctx, ReminderReceiver::class.java)
            .putExtra("id", id).putExtra("title", title).putExtra("text", text)
        return PendingIntent.getBroadcast(ctx, id, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    /** يستبدل كل التذكيرات المجدولة بالقائمة الجديدة: [{id, at, title, text}] */
    fun apply(ctx: Context, json: String) {
        cancelAll(ctx)
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, json).apply()
        scheduleStored(ctx)
    }

    fun scheduleStored(ctx: Context) {
        val json = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null) ?: return
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val now = System.currentTimeMillis()
        try {
            val arr = JSONArray(json)
            for (k in 0 until arr.length()) {
                val o = arr.getJSONObject(k)
                val at = o.getLong("at")
                if (at <= now) continue
                val id = o.getInt("id")
                am.setAndAllowWhileIdle(
                    AlarmManager.RTC_WAKEUP, at,
                    pending(ctx, id, o.optString("title", "My period"), o.optString("text", ""))
                )
            }
        } catch (e: Exception) {
            // قائمة غير صالحة: نتجاهلها
        }
    }

    private fun cancelAll(ctx: Context) {
        val json = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null) ?: return
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        try {
            val arr = JSONArray(json)
            for (k in 0 until arr.length()) {
                val id = arr.getJSONObject(k).getInt("id")
                am.cancel(pending(ctx, id, "", ""))
            }
        } catch (e: Exception) {
        }
    }

    fun show(ctx: Context, id: Int, title: String, text: String) {
        ensureChannel(ctx)
        val open = PendingIntent.getActivity(
            ctx, 0, Intent(ctx, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val n = Notification.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_flower)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        try {
            nm.notify(id, n)
        } catch (e: SecurityException) {
            // لم تُمنح صلاحية الإشعارات
        }
    }
}

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        Reminders.show(
            context,
            intent.getIntExtra("id", 0),
            intent.getStringExtra("title") ?: "My period",
            intent.getStringExtra("text") ?: ""
        )
    }
}

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) Reminders.scheduleStored(context)
    }
}
