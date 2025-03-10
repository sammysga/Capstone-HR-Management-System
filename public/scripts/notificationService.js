const supabase = require('../public/config/supabaseClient');

// Create a notification
const createNotification = async (applicantId, lineManagerId, message) => {
    const { data, error } = await supabase
        .from('notifications')
        .insert([{ applicantId, lineManagerId, message, status: 'unread' }])
        .select('*')
        .single();

    if (error) throw error;
    return data;
};

// Fetch notifications for an employee (applicant)
const getEmployeeNotifications = async (applicantId) => {
    const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('applicantId', applicantId)
        .order('timestamp', { ascending: false });

    if (error) throw error;
    return data;
};

// Fetch notifications for HR
const getHRNotifications = async () => {
    const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .or('status.eq.Pending HR,status.eq.Approved,status.eq.Rejected')
        .order('timestamp', { ascending: false });

    if (error) throw error;
    return data;
};

module.exports = { createNotification, getEmployeeNotifications, getHRNotifications };