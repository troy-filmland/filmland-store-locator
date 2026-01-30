/**
 * Filmland Store Locator
 * Production-ready vanilla JavaScript store locator with Google Maps
 */

(function() {
  'use strict';

  // Configuration
  const CONFIG = {
    mapId: 'f819752469bfd00fc0ac5d17',
    defaultCenter: { lat: 39.8, lng: -98.5 },
    defaultZoom: 4,
    dataUrl: (() => {
      try {
        const scripts = document.querySelectorAll('script[src*="app.js"]');
        const src = scripts[scripts.length - 1]?.src;
        if (src) {
          return new URL('../data/stores.json', src).href;
        }
      } catch (e) {}
      return '../data/stores.json';
    })(),
    defaultRadius: 10,
    radiusOptions: [5, 10, 25, 50, 100],
    brandColor: '#c8a951'
  };

  // Display label mapping for store types
  const TYPE_LABELS = {
    'off-premise': 'Retail',
    'on-premise': 'Bars & Restaurants'
  };

  function getTypeDisplayLabel(type) {
    if (!type) return '';
    return TYPE_LABELS[type.toLowerCase()] || type;
  }

  // State
  let map;
  let stores = [];
  let markers = [];
  let markerClusterer;
  let currentLocation = null;
  let currentRadius = CONFIG.defaultRadius;
  let filteredStores = [];
  let autocompleteElement;
  let infoWindow;
  let currentFilters = {
    type: 'all',
    product: 'all'
  };
  let isMobile = window.innerWidth <= 768;
  let mobileView = 'list'; // 'list' or 'map'

  /**
   * Wait for dependencies to load
   */
  async function waitForDependencies(maxWait = 10000) {
    const start = Date.now();
    while ((!window.google?.maps || !window.markerClusterer) && Date.now() - start < maxWait) {
      await new Promise(r => setTimeout(r, 100));
    }
    if (!window.google?.maps) throw new Error('Google Maps failed to load');
    if (!window.markerClusterer) throw new Error('MarkerClusterer failed to load');
  }

  /**
   * Initialize the application
   */
  async function init() {
    try {
      // Wait for dependencies
      await waitForDependencies();

      // Load stores data
      await loadStores();

      // Initialize Google Maps
      await initMap();

      // Setup UI
      setupDistanceFilters();
      setupTypeFilter();
      setupProductFilter();
      setupSearch();
      setupGeolocation();
      setupMobileToggle();
      setupWindowResize();

    } catch (error) {
      console.error('Initialization error:', error);
      showError('Unable to load store locations. Please try again later.');
    }
  }

  /**
   * Load stores from JSON
   */
  async function loadStores() {
    try {
      const cacheBust = `?t=${Date.now()}`;
      const response = await fetch(CONFIG.dataUrl + cacheBust);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      stores = await response.json();
    } catch (error) {
      console.error('Error loading stores:', error);
      throw error;
    }
  }

  /**
   * Initialize Google Maps
   */
  async function initMap() {
    try {
      // Load required libraries
      const { Map } = await google.maps.importLibrary('maps');
      const { AdvancedMarkerElement } = await google.maps.importLibrary('marker');
      const { PlaceAutocompleteElement } = await google.maps.importLibrary('places');

      // Create map
      const mapElement = document.getElementById('map');
      map = new Map(mapElement, {
        center: CONFIG.defaultCenter,
        zoom: CONFIG.defaultZoom,
        mapId: CONFIG.mapId,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true
      });

      // Create info window
      infoWindow = new google.maps.InfoWindow();
    } catch (error) {
      console.error('Error initializing map:', error);
      showError('Map is temporarily unavailable. Please try again later.');
      throw error;
    }
  }

  /**
   * Setup search autocomplete
   */
  async function setupSearch() {
    try {
      const { PlaceAutocompleteElement } = await google.maps.importLibrary('places');

      // Create autocomplete element
      autocompleteElement = new PlaceAutocompleteElement({
        includedRegionCodes: ['us']
      });

      // Style the autocomplete element
      autocompleteElement.placeholder = 'Enter your zip or city';

      // Add to DOM
      const searchInput = document.getElementById('search-input');
      searchInput.appendChild(autocompleteElement);

      // Handle Enter key: geocode the typed text as fallback
      autocompleteElement.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          // Small delay to let gmp-select fire first if user selected from dropdown
          setTimeout(async () => {
            const input = autocompleteElement.shadowRoot?.querySelector('input');
            const query = input?.value;
            if (!query) return;

            // Use Geocoder to resolve typed text
            const geocoder = new google.maps.Geocoder();
            try {
              const result = await geocoder.geocode({ address: query });
              if (result.results && result.results.length > 0) {
                const loc = result.results[0].geometry.location;
                currentLocation = { lat: loc.lat(), lng: loc.lng() };

                const locationLabel = document.getElementById('current-location-label');
                if (locationLabel) {
                  const addr = result.results[0].formatted_address || query;
                  const cleanText = addr.replace(/,\s*(USA|United States)$/i, '');
                  locationLabel.textContent = `Stores near ${cleanText}`;
                  locationLabel.style.display = 'block';
                }

                await filterAndDisplayStores();
              }
            } catch (err) {
              console.error('Geocode failed:', err);
            }
          }, 300);
        }
      });

      // Listen for place selection
      autocompleteElement.addEventListener('gmp-select', async (event) => {
        const placePrediction = event.placePrediction;
        const place = placePrediction.toPlace();

        await place.fetchFields({ fields: ['location', 'formattedAddress'] });
        const location = place.location;

        if (location) {
          currentLocation = {
            lat: location.lat(),
            lng: location.lng()
          };

          // Update location label with full address
          const locationLabel = document.getElementById('current-location-label');
          if (locationLabel) {
            const locationText = place.formattedAddress || placePrediction.text?.toString() || '';
            if (locationText) {
              // Remove country suffix (", USA" or ", United States")
              const cleanText = locationText.replace(/,\s*(USA|United States)$/i, '');
              locationLabel.textContent = `Stores near ${cleanText}`;
              locationLabel.style.display = 'block';
            }
          }

          // Filter and display stores
          await filterAndDisplayStores();
        }
      });

    } catch (error) {
      console.error('Error setting up search:', error);
    }
  }

  /**
   * Setup geolocation
   */
  function setupGeolocation() {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          currentLocation = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
          };

          // Reverse geocode to show user's location
          const geocoder = new google.maps.Geocoder();
          geocoder.geocode({ location: currentLocation }, (results, status) => {
            if (status === 'OK' && results[0]) {
              // Prefer neighborhood/sublocality, then postal code, then first result
              const neighborhood = results.find(r => r.types.includes('neighborhood') || r.types.includes('sublocality'));
              const postalCode = results.find(r => r.types.includes('postal_code'));
              const locality = results.find(r => r.types.includes('locality'));
              const best = neighborhood || postalCode || locality || results[0];
              let locationText = best.formatted_address;
              const locationLabel = document.getElementById('current-location-label');
              if (locationLabel) {
                locationLabel.textContent = `Stores near ${locationText}`;
                locationLabel.style.display = 'block';
              }
            }
          });

          filterAndDisplayStores();
        },
        () => {
          // Show all stores clustered
          showAllStores();
        }
      );
    } else {
      showAllStores();
    }
  }

  /**
   * Show all stores on map (no location filter)
   */
  async function showAllStores() {
    filteredStores = [...stores];

    // Apply type filter
    if (currentFilters.type !== 'all') {
      filteredStores = filteredStores.filter(store =>
        store.type && store.type.toLowerCase() === currentFilters.type.toLowerCase()
      );
    }

    // Apply product filter
    if (currentFilters.product !== 'all') {
      filteredStores = filteredStores.filter(store =>
        store.products && store.products.includes(currentFilters.product)
      );
    }

    updateStoreList();
    await updateMarkers();

    // Update placeholder
    const resultsInfo = document.getElementById('results-info');
    if (resultsInfo) {
      resultsInfo.textContent = 'Enter your zip or city to find nearby stores';
    }
  }

  /**
   * Filter and display stores based on current location and radius
   */
  async function filterAndDisplayStores() {
    if (!currentLocation) {
      await showAllStores();
      return;
    }

    // Filter by distance
    const storesWithDistance = stores.map(store => ({
      ...store,
      distance: calculateDistance(currentLocation, { lat: store.lat, lng: store.lng })
    }));

    filteredStores = storesWithDistance
      .filter(store => store.distance <= currentRadius)
      .sort((a, b) => a.distance - b.distance);

    // Apply type filter
    if (currentFilters.type !== 'all') {
      filteredStores = filteredStores.filter(store =>
        store.type && store.type.toLowerCase() === currentFilters.type.toLowerCase()
      );
    }

    // Apply product filter
    if (currentFilters.product !== 'all') {
      filteredStores = filteredStores.filter(store =>
        store.products && store.products.includes(currentFilters.product)
      );
    }

    updateStoreList();

    // Update results info
    const resultsInfo = document.getElementById('results-info');
    if (resultsInfo) {
      if (filteredStores.length === 0) {
        resultsInfo.innerHTML = `<div class="no-results">No stores found within ${currentRadius} miles. Try expanding your search.</div>`;
      } else {
        resultsInfo.textContent = `${filteredStores.length} store${filteredStores.length !== 1 ? 's' : ''} within ${currentRadius} miles`;
      }
    }

    await updateMarkers();
  }

  /**
   * Calculate distance between two points using Haversine formula
   * Returns distance in miles
   */
  function calculateDistance(point1, point2) {
    const R = 3959; // Earth's radius in miles
    const dLat = toRad(point2.lat - point1.lat);
    const dLng = toRad(point2.lng - point1.lng);
    const lat1 = toRad(point1.lat);
    const lat2 = toRad(point2.lat);

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function toRad(degrees) {
    return degrees * (Math.PI / 180);
  }

  /**
   * Update map markers
   */
  async function updateMarkers() {
    // Clear existing markers
    if (markerClusterer) {
      markerClusterer.clearMarkers();
    }
    markers.forEach(marker => marker.map = null);
    markers = [];

    // Create markers for filtered stores
    const { AdvancedMarkerElement, PinElement } = await google.maps.importLibrary('marker');

    const storesToShow = (filteredStores.length > 0 || currentLocation) ? filteredStores : stores;

    for (const store of storesToShow) {
      let markerContent;
      const storeType = (store.type || '').toLowerCase();

      if (storeType === 'off-premise') {
        // Retail pin — storefront/building icon
        markerContent = document.createElement('div');
        markerContent.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="48" viewBox="0 0 36 48">
          <defs>
            <filter id="rs" x="-10%" y="-5%" width="120%" height="120%">
              <feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-opacity="0.3"/>
            </filter>
          </defs>
          <path d="M18 0C8.06 0 0 8.06 0 18c0 13.5 18 30 18 30s18-16.5 18-30C36 8.06 27.94 0 18 0z" fill="${CONFIG.brandColor}" filter="url(#rs)"/>
          <path d="M18 0C8.06 0 0 8.06 0 18c0 13.5 18 30 18 30s18-16.5 18-30C36 8.06 27.94 0 18 0z" fill="none" stroke="#fff" stroke-width="1.5"/>
          <circle cx="18" cy="18" r="12" fill="#fff" opacity="0.15"/>
          <rect x="10" y="13" width="16" height="12" rx="1" fill="none" stroke="#1a1a1a" stroke-width="1.6"/>
          <path d="M9 13 L18 9 L27 13" fill="none" stroke="#1a1a1a" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          <rect x="15" y="19" width="6" height="6" rx="0.5" fill="#1a1a1a"/>
          <rect x="12" y="15" width="4" height="3" rx="0.5" fill="none" stroke="#1a1a1a" stroke-width="1.2"/>
          <rect x="20" y="15" width="4" height="3" rx="0.5" fill="none" stroke="#1a1a1a" stroke-width="1.2"/>
        </svg>`;
      } else if (storeType === 'on-premise') {
        // Bars & Restaurants pin — old-fashioned whiskey glass icon
        markerContent = document.createElement('div');
        markerContent.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="48" viewBox="0 0 36 48">
          <defs>
            <filter id="bs" x="-10%" y="-5%" width="120%" height="120%">
              <feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-opacity="0.3"/>
            </filter>
          </defs>
          <path d="M18 0C8.06 0 0 8.06 0 18c0 13.5 18 30 18 30s18-16.5 18-30C36 8.06 27.94 0 18 0z" fill="${CONFIG.brandColor}" filter="url(#bs)"/>
          <path d="M18 0C8.06 0 0 8.06 0 18c0 13.5 18 30 18 30s18-16.5 18-30C36 8.06 27.94 0 18 0z" fill="none" stroke="#fff" stroke-width="1.5"/>
          <circle cx="18" cy="18" r="12" fill="#fff" opacity="0.15"/>
          <path d="M11.5 9 L13 20 C13 20 13.5 22 18 22 C22.5 22 23 20 23 20 L24.5 9 Z" fill="none" stroke="#1a1a1a" stroke-width="1.6" stroke-linejoin="round"/>
          <path d="M13.4 14 L12.6 18.5 C12.8 19.8 14.5 20.5 18 20.5 C21.5 20.5 23.2 19.8 23.4 18.5 L22.6 14 Z" fill="#1a1a1a" opacity="0.25"/>
          <line x1="18" y1="22" x2="18" y2="25" stroke="#1a1a1a" stroke-width="1.6"/>
          <line x1="14" y1="25" x2="22" y2="25" stroke="#1a1a1a" stroke-width="1.8" stroke-linecap="round"/>
          <circle cx="21" cy="11" r="1.5" fill="none" stroke="#1a1a1a" stroke-width="1.2"/>
        </svg>`;
      } else {
        // Default pin for stores with no type
        const pinElement = new PinElement({
          background: CONFIG.brandColor,
          borderColor: '#ffffff',
          glyphColor: '#1a1a1a',
          scale: 1.0
        });
        markerContent = pinElement.element;
      }

      const marker = new AdvancedMarkerElement({
        map: map,
        position: { lat: store.lat, lng: store.lng },
        content: markerContent,
        title: store.name
      });

      // Add click listener
      marker.addListener('click', () => {
        showInfoWindow(marker, store);
        highlightStoreInList(store);
        scrollToStore(store);
      });

      markers.push(marker);
    }

    // Fit map to show all markers plus user location
    if (storesToShow.length > 0) {
      const bounds = new google.maps.LatLngBounds();
      if (currentLocation) {
        bounds.extend(currentLocation);
      }
      storesToShow.forEach(store => {
        bounds.extend({ lat: store.lat, lng: store.lng });
      });
      map.fitBounds(bounds);

      // Limit zoom level
      google.maps.event.addListenerOnce(map, 'bounds_changed', () => {
        if (map.getZoom() > 15) {
          map.setZoom(15);
        }
      });
    } else if (currentLocation) {
      // No stores found — keep centered on user location
      map.setCenter(currentLocation);
      map.setZoom(11);
    }

    // Setup marker clustering AFTER fitBounds
    if (window.markerClusterer && window.markerClusterer.MarkerClusterer) {
      if (markerClusterer) {
        markerClusterer.clearMarkers();
      }
      markerClusterer = new markerClusterer.MarkerClusterer({
        map,
        markers
      });
    }
  }

  /**
   * Show info window for a store
   */
  function showInfoWindow(marker, store) {
    const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(store.address + ', ' + store.city + ', ' + store.state + ' ' + store.zip)}`;

    let content = `
      <div class="info-window">
        <h3>${escapeHtml(store.name)}</h3>
        <p class="info-address">
          ${escapeHtml(store.address)}<br>
          ${escapeHtml(store.city)}, ${escapeHtml(store.state)} ${escapeHtml(store.zip)}
        </p>
    `;

    if (store.phone) {
      content += `<p class="info-phone"><a href="tel:${escapeHtml(store.phone)}">${escapeHtml(store.phone)}</a></p>`;
    }

    content += `
        <p class="info-directions">
          <a href="${directionsUrl}" target="_blank" rel="noopener noreferrer">Get Directions</a>
        </p>
      </div>
    `;

    infoWindow.setContent(content);
    infoWindow.open({ anchor: marker, map });
  }

  /**
   * Update store list
   */
  function updateStoreList() {
    const storeList = document.getElementById('store-list');
    if (!storeList) return;

    storeList.innerHTML = '';

    const storesToShow = (filteredStores.length > 0 || currentLocation) ? filteredStores : stores;

    if (storesToShow.length === 0) {
      storeList.innerHTML = '<div class="no-results">No stores found within the selected radius.</div>';
      return;
    }

    storesToShow.forEach((store, index) => {
      const card = createStoreCard(store, index);
      storeList.appendChild(card);
    });
  }

  /**
   * Create store card element
   */
  function createStoreCard(store, index) {
    const card = document.createElement('div');
    card.className = 'store-card';
    card.dataset.storeIndex = index;

    let html = `
      <h3 class="store-name">${escapeHtml(store.name)}</h3>
      <p class="store-address">
        ${escapeHtml(store.address)}<br>
        ${escapeHtml(store.city)}, ${escapeHtml(store.state)} ${escapeHtml(store.zip)}
      </p>
    `;

    if (store.phone) {
      html += `<p class="store-phone"><a href="tel:${escapeHtml(store.phone)}">${escapeHtml(store.phone)}</a></p>`;
    }

    if (store.type) {
      html += `<span class="store-type-badge">${escapeHtml(getTypeDisplayLabel(store.type))}</span>`;
    }

    if (store.products && store.products.length > 0) {
      html += `<p class="store-products"><strong>Products:</strong> ${store.products.map(p => escapeHtml(p)).join(', ')}</p>`;
    }

    if (store.distance !== undefined) {
      html += `<p class="store-distance">${store.distance.toFixed(1)} miles away</p>`;
    }

    const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(store.address + ', ' + store.city + ', ' + store.state + ' ' + store.zip)}`;
    html += `<a href="${directionsUrl}" target="_blank" rel="noopener noreferrer" class="store-directions">Get Directions</a>`;

    card.innerHTML = html;

    // Add click listener
    card.addEventListener('click', () => {
      const marker = markers[index];
      if (marker) {
        map.panTo({ lat: store.lat, lng: store.lng });
        map.setZoom(15);
        showInfoWindow(marker, store);
        highlightStoreInList(store);

        // Switch to map view on mobile
        if (isMobile) {
          setMobileView('map');
        }
      }
    });

    return card;
  }

  /**
   * Highlight a store in the list
   */
  function highlightStoreInList(store) {
    const cards = document.querySelectorAll('.store-card');
    cards.forEach(card => card.classList.remove('active'));

    const matchingCard = Array.from(cards).find(card => {
      const name = card.querySelector('.store-name').textContent;
      const address = card.querySelector('.store-address').textContent;
      return name === store.name && address.includes(store.address);
    });

    if (matchingCard) {
      matchingCard.classList.add('active');
    }
  }

  /**
   * Scroll to store in list
   */
  function scrollToStore(store) {
    const cards = document.querySelectorAll('.store-card');
    const matchingCard = Array.from(cards).find(card => {
      const name = card.querySelector('.store-name').textContent;
      return name === store.name;
    });

    if (matchingCard) {
      matchingCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  /**
   * Setup distance filters
   */
  function setupDistanceFilters() {
    const container = document.getElementById('distance-filters');
    if (!container) return;

    CONFIG.radiusOptions.forEach(radius => {
      const button = document.createElement('button');
      button.className = 'distance-filter-btn';
      button.textContent = `${radius} mi`;
      button.dataset.radius = radius;

      if (radius === CONFIG.defaultRadius) {
        button.classList.add('active');
      }

      button.addEventListener('click', async () => {
        currentRadius = radius;

        // Update active state
        container.querySelectorAll('.distance-filter-btn').forEach(btn => {
          btn.classList.remove('active');
        });
        button.classList.add('active');

        // Re-filter and display
        await filterAndDisplayStores();
      });

      container.appendChild(button);
    });
  }

  /**
   * Setup type filter
   */
  function setupTypeFilter() {
    const container = document.getElementById('type-filter-container');
    if (!container) return;

    // Check if any stores have type data
    const hasTypeData = stores.some(store => store.type && store.type.trim() !== '');

    if (!hasTypeData) {
      container.style.display = 'none';
      return;
    }

    // Get unique types
    const types = ['all', ...new Set(stores.filter(s => s.type).map(s => s.type))];

    const select = document.getElementById('type-filter');
    select.innerHTML = '';

    types.forEach(type => {
      const option = document.createElement('option');
      option.value = type.toLowerCase();
      option.textContent = type === 'all' ? 'All Types' : getTypeDisplayLabel(type);
      select.appendChild(option);
    });

    select.addEventListener('change', async (e) => {
      currentFilters.type = e.target.value;
      await filterAndDisplayStores();
    });
  }

  /**
   * Setup product filter
   */
  function setupProductFilter() {
    const container = document.getElementById('product-filter-container');
    if (!container) return;

    // Check if any stores have product data
    const hasProductData = stores.some(store => store.products && store.products.length > 0);

    if (!hasProductData) {
      container.style.display = 'none';
      return;
    }

    // Get unique products
    const productsSet = new Set();
    stores.forEach(store => {
      if (store.products) {
        store.products.forEach(product => productsSet.add(product));
      }
    });

    const products = ['all', ...Array.from(productsSet).sort()];

    const select = document.getElementById('product-filter');
    select.innerHTML = '';

    products.forEach(product => {
      const option = document.createElement('option');
      option.value = product;
      option.textContent = product === 'all' ? 'All Products' : product;
      select.appendChild(option);
    });

    select.addEventListener('change', async (e) => {
      currentFilters.product = e.target.value;
      await filterAndDisplayStores();
    });
  }

  /**
   * Setup mobile view toggle
   */
  function setupMobileToggle() {
    const mapBtn = document.getElementById('mobile-map-btn');
    const listBtn = document.getElementById('mobile-list-btn');

    if (!mapBtn || !listBtn) return;

    mapBtn.addEventListener('click', () => setMobileView('map'));
    listBtn.addEventListener('click', () => setMobileView('list'));

    updateMobileView();
  }

  /**
   * Set mobile view (map or list)
   */
  function setMobileView(view) {
    mobileView = view;
    updateMobileView();
  }

  /**
   * Update mobile view state
   */
  function updateMobileView() {
    if (!isMobile) return;

    const mapBtn = document.getElementById('mobile-map-btn');
    const listBtn = document.getElementById('mobile-list-btn');
    const sidebar = document.querySelector('.store-locator-sidebar');
    const mapContainer = document.querySelector('.store-locator-map');

    if (mobileView === 'map') {
      mapBtn?.classList.add('active');
      listBtn?.classList.remove('active');
      sidebar?.classList.remove('mobile-active');
      mapContainer?.classList.add('mobile-active');

      // Trigger map resize and fit to stores
      if (map) {
        google.maps.event.trigger(map, 'resize');
        const storesToShow = (filteredStores.length > 0 || currentLocation) ? filteredStores : stores;
        if (storesToShow.length > 0) {
          const bounds = new google.maps.LatLngBounds();
          if (currentLocation) bounds.extend(currentLocation);
          storesToShow.forEach(store => bounds.extend({ lat: store.lat, lng: store.lng }));
          map.fitBounds(bounds);
        } else if (currentLocation) {
          map.setCenter(currentLocation);
          map.setZoom(11);
        }
      }
    } else {
      listBtn?.classList.add('active');
      mapBtn?.classList.remove('active');
      sidebar?.classList.add('mobile-active');
      mapContainer?.classList.remove('mobile-active');
    }
  }

  /**
   * Setup window resize handler
   */
  function setupWindowResize() {
    let resizeTimeout;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        const wasMobile = isMobile;
        isMobile = window.innerWidth <= 768;

        if (wasMobile !== isMobile) {
          updateMobileView();
        }
      }, 250);
    });
  }

  /**
   * Show error message
   */
  function showError(message) {
    const container = document.querySelector('.store-locator-container');
    if (container) {
      const errorDiv = document.createElement('div');
      errorDiv.className = 'error-message';
      errorDiv.textContent = message;
      container.insertBefore(errorDiv, container.firstChild);
    }
  }

  /**
   * Escape HTML to prevent XSS
   */
  function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
