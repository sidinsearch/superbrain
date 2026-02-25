package com.superbrain.mobile

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log

class ShareActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        Log.d("SuperBrain", "ShareActivity - onCreate")
        Log.d("SuperBrain", "ShareActivity - Intent action: ${intent?.action}")
        Log.d("SuperBrain", "ShareActivity - Intent type: ${intent?.type}")
        
        // Handle the share intent
        if (intent?.action == Intent.ACTION_SEND && intent.type == "text/plain") {
            val sharedText = intent.getStringExtra(Intent.EXTRA_TEXT)
            Log.d("SuperBrain", "ShareActivity - Shared text: $sharedText")
            
            if (!sharedText.isNullOrEmpty()) {
                // Extract Instagram URL
                val instagramUrlPattern = Regex("(https?://(?:www\\.)?instagram\\.com/(?:p|reel|tv)/[A-Za-z0-9_-]+/?)")
                val matchResult = instagramUrlPattern.find(sharedText)
                val instagramUrl = matchResult?.value ?: sharedText
                
                Log.d("SuperBrain", "ShareActivity - Extracted URL: $instagramUrl")
                
                // Launch MainActivity with deep link
                val deepLinkIntent = Intent(Intent.ACTION_VIEW).apply {
                    data = Uri.parse("superbrain://share?url=${Uri.encode(instagramUrl)}")
                    setClassName(this@ShareActivity, "com.superbrain.mobile.MainActivity")
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                }
                
                Log.d("SuperBrain", "ShareActivity - Launching MainActivity with deep link: ${deepLinkIntent.data}")
                startActivity(deepLinkIntent)
            }
        }
        
        // Finish this activity immediately
        finish()
    }
}
