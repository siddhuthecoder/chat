import {
  NotificationHubsClient,
  FcmV1Notification,
} from "@azure/notification-hubs";
import { getValueFromKeyVault } from "../services/keyVault";

type DeviceTokens = {
  web_device_token: string;
  mobile_device_token: string;
};

interface NotificationOptions {
  title: string;
  body: string;
  data?: Record<string, string>;
  deviceHandle?: DeviceTokens;
  attachmentArray?: any[];
}

// Azure Key Vault configuration
const COMMS_PUSH_CONNECTION_STRING = `${process.env.COMMS_PUSH_CONNECTION_STRING}`;
const hubName = `${process.env.NOTIFICATION_HUB_NAME}`;

// Function to fetch Notification Hub connection string from Key Vault
async function getNotificationHubConnectionString(): Promise<string> {
  const secret = await getValueFromKeyVault(COMMS_PUSH_CONNECTION_STRING);

  if (!secret) {
    return "";
  }
  return secret;
}

const sendPushNotification = async ({
  title,
  body,
  data,
  deviceHandle,
  attachmentArray,
}: NotificationOptions) => {
  console.log(
    "sendPushNotification",
    title,
    body,
    data,
    deviceHandle,
    attachmentArray
  );

  try {
    // Get the connection string and hub name
    const connectionString = await getNotificationHubConnectionString();
    if (!connectionString) {
      console.error("Failed to retrieve Notification Hub connection string from Key Vault.");
      return {
        success: false,
        message: "Failed to retrieve Notification Hub connection string from Key Vault.",
      };
    }

    // Initialize the NotificationHubServiceClient
    const hubClient = new NotificationHubsClient(connectionString, hubName);

    const notificationData = {
      ...data,
      attachments: attachmentArray ? JSON.stringify(attachmentArray) : undefined,
    };

    // Define the FCM V1 notification payload
    const notificationPayload: FcmV1Notification = {
      platform: "fcmv1",
      contentType: "application/json;charset=utf-8",
      body: JSON.stringify({
        message: {
          notification: {
            title,
            body,
          },
          data: notificationData,
        },
      }),
    };

    const promises = [];

    if (deviceHandle?.web_device_token) {
      promises.push(
        hubClient
          .sendNotification(notificationPayload, {
            deviceHandle: deviceHandle.web_device_token,
          })
          .then(() =>
            console.log(
              `Notification sent to web device: ${deviceHandle.web_device_token}`
            )
          )
          .catch((error) => {
            console.error("Failed to send notification to web device:", error);
            throw error; // Re-throw to be caught by the main try-catch
          })
      );
    }

    if (deviceHandle?.mobile_device_token) {
      promises.push(
        hubClient
          .sendNotification(notificationPayload, {
            deviceHandle: deviceHandle.mobile_device_token,
          })
          .then(() =>
            console.log(
              `Notification sent to mobile device: ${deviceHandle.mobile_device_token}`
            )
          )
          .catch((error) => {
            console.error("Failed to send notification to mobile device:", error);
            throw error; // Re-throw to be caught by the main try-catch
          })
      );
    }

    // Wait for all notifications to be sent
    await Promise.all(promises);
    console.log("Notifications sent to all available devices.");
    return {
      success: true,
      message: "Push notification sent successfully.",
    };
  } catch (error) {
    console.error("Error sending push notification:", error);
    // Don't throw the error, just return failure status
    return {
      success: false,
      message: "Push notification sending failed.",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
};

export default sendPushNotification; 