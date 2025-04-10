import React, { useState, useEffect } from 'react';
import { View, ActivityIndicator, Alert } from 'react-native'; // Added ActivityIndicator, Alert
import { Card, Text, Button, Title, Paragraph } from 'react-native-paper';
// import mockProviders from '../../utils/mockProviders'; // Remove mock data
import supabase from '../../../utils/supabaseClient';
import BookingRequestForm from './BookingRequestForm';
import BookingRequests, { BookingRequest } from './BookingRequests';
import { Database } from '../../../types/database.types'; // Import generated types

// Define type alias for convenience
type Service = Database['public']['Tables']['services']['Row'];
type User = Database['public']['Tables']['users']['Row'];
type Booking = Database['public']['Tables']['bookings']['Row'];
type BookingStatus = Database['public']['Enums']['booking_status'];

// Define the combined type for service with provider info
type ServiceWithProvider = Service & {
  users: Pick<User, 'name'> | null; // Fetching only the name from the related user
};

// Define the structure of data coming from the form
export interface BookingFormData { // Add export keyword
    booking_date: string; // Or Date object, depending on form implementation
    // time: string; // Removed as per schema (DateTime)
    special_requests: string;
}

// Remove SupabaseBooking interface, use generated Booking type

// Define props for the component
interface ProviderListProps {
  onBookingMade?: () => void; // Renamed prop
}

const ProviderList: React.FC<ProviderListProps> = ({ onBookingMade }) => { // Destructure renamed prop
  const [services, setServices] = useState<ServiceWithProvider[]>([]); // State for fetched services
  const [isLoadingServices, setIsLoadingServices] = useState<boolean>(true); // Loading state for services
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null); // Changed from providerId to serviceId
  const [bookingRequests, setBookingRequests] = useState<BookingRequest[]>([]);
  const [clientId, setClientId] = useState<string | null>(null); // State for the logged-in user's ID
  // TODO: Replace with actual user role from auth context/state or fetched profile
  const userRole: 'client' | 'practitioner' = 'client'; // Keep placeholder for now

  const handleBookingRequest = async (request: BookingFormData, serviceId: string) => {
    if (!clientId) {
      Alert.alert("Error", "You must be logged in to make a booking request.");
      return;
    }
    const bookingDataToInsert = {
      service_id: serviceId,
      client_id: clientId,
      booking_date: request.booking_date,
      special_requests: request.special_requests,
      status: 'pending' as const // Ensure type is 'pending'
    };

    console.log("ProviderList: Attempting to insert booking:", JSON.stringify(bookingDataToInsert, null, 2)); // Log data before insert

    const { data, error } = await supabase
      .from('bookings')
      .insert([bookingDataToInsert])
      .select() // Select the inserted row to potentially use it
      .single(); // Expecting a single row back
      
    if (error) {
      console.error('Error storing booking request:', error);
      // TODO: Show user feedback
    } else {
      console.log('Booking request stored:', data);
      // Call the callback function passed from HomeScreen to trigger refresh
      if (onBookingMade) { // Check renamed prop
        console.log("ProviderList: Calling onBookingMade callback."); // Update log
        onBookingMade(); // Call renamed prop
      }
      // Realtime should also update the list, but calling the callback ensures
      // the "Next Appointment" section in HomeScreen refreshes immediately.
    }
    setSelectedServiceId(null); // Clear selected service ID after submission
  };

  const handleRespond = async (id: string, status: BookingStatus) => { // Use generated Enum type
    console.log(`Provider responded to request ${id}: ${status}`);
    
    // Update status in Supabase
    const { error } = await supabase
      .from('bookings')
      .update({ status }) // Use the enum type
      .eq('id', id);

    if (error) {
      console.error('Error updating booking status:', error);
    } else {
      // Update local state to reflect the change
      // Update local state to reflect the change immediately
      setBookingRequests(prevRequests =>
        prevRequests.map(req =>
          req.id === id ? { ...req, status: status } : req // Assumes req matches BookingRequest structure
        )
      );
      // Simulate notifying the client
      console.log(`Notify client: Your booking request (ID: ${id}) was ${status}.`);
    }
  };

  // TODO: Ensure 'cancelled' is added to the 'booking_status' enum in the Supabase database schema.
  const handleCancel = async (id: string) => {
    console.log(`Client cancelling booking request ${id}`);

    // Update status to 'cancelled' in Supabase
    const { error } = await supabase
      .from('bookings')
      .update({ status: 'cancelled' }) // Use the new status
      .eq('id', id);

    if (error) {
      console.error('Error cancelling booking:', error);
      // TODO: Show user feedback
    } else {
      // Update local state immediately (or rely on realtime)
      setBookingRequests(prevRequests =>
        prevRequests.map(req =>
          req.id === id ? { ...req, status: 'cancelled' } : req
        )
      );
      console.log(`Booking request (ID: ${id}) cancelled.`);
    }
  };

  const fetchBookingRequests = async (currentUserId: string | null) => { // Accept userId as parameter
    if (!currentUserId) {
      console.log("No user ID available, skipping booking fetch.");
      setBookingRequests([]);
      return;
    }
    // Use the component-level userRole defined above (needs dynamic update later)

    let query = supabase
      .from('bookings')
      .select(`
        *,
        services (
          title,
          users ( name )
        )
      `) // Fetch booking details, service title, and practitioner name
      .order('updated_at', { ascending: false })
      .limit(3); // Limit the query to fetch only 3 records

    if (userRole === 'client') {
      query = query.eq('client_id', currentUserId); // Use the passed userId
    } else if (userRole === 'practitioner') {
      // Fetch service IDs owned by the practitioner
      const { data: practitionerServices, error: serviceError } = await supabase
        .from('services')
        .select('id')
        .eq('user_id', currentUserId); // Use the passed userId

      if (serviceError) {
        console.error('Error fetching practitioner services:', serviceError);
        setBookingRequests([]);
        return; // Exit if services can't be fetched
      }

      const serviceIds = practitionerServices?.map(s => s.id) || [];

      if (serviceIds.length > 0) {
        query = query.in('service_id', serviceIds);
      } else {
        // If practitioner has no services, they have no bookings to see
        setBookingRequests([]);
        return;
      }
    } else {
        // Handle cases where role is unknown or not set
        console.warn("User role not determined, cannot fetch specific bookings.");
        setBookingRequests([]);
        return;
    }

    // Execute the constructed query
    const { data, error } = await query;

    console.log('[fetchBookingRequests] Raw data from Supabase:', data); // Log raw data
    console.log('[fetchBookingRequests] Error from Supabase:', error); // Log error explicitly

    if (error) {
      console.error('Error fetching booking requests:', error);
      setBookingRequests([]); // Set to empty array on error
    } else {
      console.log(`[fetchBookingRequests] Successfully fetched ${data?.length ?? 0} raw bookings.`); // Log count
      // Transform Supabase data to match the BookingRequest prop type if necessary
      interface FormattedBookingRequest extends BookingRequest {
          time: string; // Add 'time' field to extend BookingRequest
      }

      // Define a type for the fetched data including nested relations
      type BookingWithDetailsServiceAndUser = Booking & {
        services: {
          title: string | null;
          users: { name: string | null } | null;
        } | null;
      };

      // Transform Supabase data to match the BookingRequest prop type
      const formattedRequests: BookingRequest[] = (data as BookingWithDetailsServiceAndUser[] || []).map((req): BookingRequest => {
        const bookingDateTime = new Date(req.booking_date); // Create Date object once
        return {
          id: req.id,
          booking_date: bookingDateTime.toLocaleDateString(), // Extract date part
          time: bookingDateTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), // Extract time part
          special_requests: req.special_requests ?? '', // Handle null
          status: req.status,
          // Add service title and practitioner name
          serviceTitle: req.services?.title ?? 'Unknown Service',
          practitionerName: req.services?.users?.name ?? 'Unknown Practitioner',
        };
      });
      setBookingRequests(formattedRequests);
      console.log(`[fetchBookingRequests] Set ${formattedRequests.length} formatted requests to state.`); // Log formatted count
    }
  };

  // Fetch user ID, services, booking requests, set up realtime
  useEffect(() => {
    // Fetch current user session
    const fetchCurrentUser = async () => {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error) {
        console.error("Error fetching session:", error);
        Alert.alert("Authentication Error", "Could not retrieve user session.");
      } else if (session?.user) {
        console.log("User session found, ID:", session.user.id);
        setClientId(session.user.id);
        // Fetch bookings only after getting the client ID
        fetchBookingRequests(session.user.id);
      } else {
        console.log("No active user session found.");
        // Handle case where user is not logged in - maybe show login prompt or disable booking
        setBookingRequests([]); // Ensure bookings are cleared if user logs out
      }
    };

    fetchCurrentUser();

    const fetchServices = async () => {
      setIsLoadingServices(true);
      const { data, error } = await supabase
        .from('services')
        .select(`
          *,
          users ( name )
        `); // Fetch services and related user's name

      if (error) {
        console.error('Error fetching services:', error);
        setServices([]);
      } else {
        // Filter out services where the user relationship might be null if needed,
        // or handle the null case in rendering.
        console.log('Fetched services:', data); // Keep a log for confirmation
        setServices(data as ServiceWithProvider[] || []);
      }
      setIsLoadingServices(false);
    };

    fetchServices();
    // fetchBookingRequests(); // Moved inside fetchCurrentUser to ensure clientId is available

    // Set up Supabase Realtime subscription for bookings
    const bookingsChannel = supabase.channel('public:bookings')
      .on<Booking>( // Use the generated type for payload
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings' },
        (payload) => {
          console.log('Bookings change received!', payload);
          // Re-fetch data or update state smartly based on payload
          // For simplicity, re-fetching using the stored clientId:
          fetchBookingRequests(clientId); // Pass the stored clientId
        }
      )
      .subscribe();

    // Optional: Add subscription for services if they can change
    // const servicesChannel = supabase.channel('public:services')...subscribe();

    // Cleanup function
    return () => {
      supabase.removeChannel(bookingsChannel);
      // supabase.removeChannel(servicesChannel); // If added
    };
  }, []);


  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Title style={{ marginBottom: 16, fontSize: 22, fontWeight: 'bold' }}>Available Services</Title>
      {isLoadingServices ? (
        <ActivityIndicator animating={true} size="large" style={{ marginTop: 20 }} />
      ) : (
        <View style={{ marginBottom: 20 }}>
          {services.length === 0 && <Text style={{ fontSize: 16 }}>No services available currently.</Text>}
          {services.map((service) => (
            <Card key={service.id} style={{ marginBottom: 16 }}>
              <Card.Content>
                <Title style={{ fontSize: 18, marginBottom: 4 }}>{service.title}</Title>
                {/* Display provider name if available */}
                {service.users?.name && <Paragraph style={{ fontSize: 15 }}>Provider: {service.users.name}</Paragraph>}
                {service.description && <Paragraph style={{ fontSize: 15 }}>{service.description}</Paragraph>}
                {service.specialties && service.specialties.length > 0 && (
                  <Paragraph style={{ fontSize: 15 }}>Specialties: {service.specialties.join(', ')}</Paragraph>
                )}
                 {service.price && <Paragraph style={{ fontSize: 15 }}>Price: ${service.price.toFixed(2)}</Paragraph>}
                {/* Add Rating later if implemented */}
              </Card.Content>
              <Card.Actions>
                <Button
                  mode="contained"
                  labelStyle={{ fontSize: 15 }} // Make button text larger
                  onPress={() => {
                    // Toggle behavior: If this service's form is already open, close it. Otherwise, open it.
                    setSelectedServiceId(prevId => prevId === service.id ? null : service.id);
                  }}
                >
                  Request Booking
                </Button>
              </Card.Actions>
              {/* Conditionally render BookingRequestForm inline */}
              {selectedServiceId === service.id && (
                <View style={{ marginTop: 8, marginBottom: 8 }}> {/* Add some spacing */}
                  <BookingRequestForm
                    onSubmit={(formData: BookingFormData) => handleBookingRequest(formData, selectedServiceId)}
                    onCancel={() => {
                        setSelectedServiceId(null); // Clear selected service ID
                    }}
                  />
                </View>
              )}
            </Card>
          ))}
        </View>
      )}
      {/* BookingRequestForm is now rendered inline with each service card above */}

      {/* Display existing booking requests */}
      {bookingRequests.length > 0 && (
        <View style={{ marginTop: 24 }}>
           {/* TODO: Replace 'client' with actual userRole from auth state */}
           <BookingRequests
             requests={bookingRequests}
             userRole={userRole} // Pass the component-level user role
             onRespond={handleRespond}
             onCancel={handleCancel} // Pass the cancel handler
           />
        </View>
      )}
    </View>
  );
};

export default ProviderList;