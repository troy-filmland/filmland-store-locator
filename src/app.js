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
      const response = await fetch(CONFIG.dataUrl);
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
        componentRestrictions: { country: 'us' }
      });

      // Style the autocomplete element
      autocompleteElement.placeholder = 'Enter your zip code or city';

      // Add to DOM
      const searchInput = document.getElementById('search-input');
      searchInput.appendChild(autocompleteElement);

      // Listen for place selection
      autocompleteElement.addEventListener('gmp-placeselect', async (event) => {
        const place = event.place;

        // PlaceAutocompleteElement provides location automatically, only fetch as fallback
        const location = place.location || (await place.fetchFields({ fields: ['location'] })).location;

        if (location) {
          currentLocation = {
            lat: location.lat(),
            lng: location.lng()
          };

          // Center map on selected place
          map.setCenter(currentLocation);
          map.setZoom(11);

          // Filter and display stores
          filterAndDisplayStores();
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

          map.setCenter(currentLocation);
          map.setZoom(11);

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
  function showAllStores() {
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

    updateMarkers();
    updateStoreList();

    // Update placeholder
    const resultsInfo = document.getElementById('results-info');
    if (resultsInfo) {
      resultsInfo.textContent = 'Enter your zip code or city to find nearby stores';
    }
  }

  /**
   * Filter and display stores based on current location and radius
   */
  function filterAndDisplayStores() {
    if (!currentLocation) {
      showAllStores();
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

    updateMarkers();
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
      // Create custom pin
      const pinElement = new PinElement({
        background: CONFIG.brandColor,
        borderColor: '#ffffff',
        glyphColor: '#1a1a1a',
        scale: 1.0
      });

      const marker = new AdvancedMarkerElement({
        map: map,
        position: { lat: store.lat, lng: store.lng },
        content: pinElement.element,
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

    // Setup marker clustering
    if (window.markerClusterer && window.markerClusterer.MarkerClusterer) {
      if (markerClusterer) {
        markerClusterer.clearMarkers();
      }
      markerClusterer = new markerClusterer.MarkerClusterer({
        map,
        markers
      });
    }

    // Fit map to show all markers if we have filtered results
    if (filteredStores.length > 0 && currentLocation) {
      const bounds = new google.maps.LatLngBounds();
      filteredStores.forEach(store => {
        bounds.extend({ lat: store.lat, lng: store.lng });
      });
      map.fitBounds(bounds);

      // Limit zoom level
      google.maps.event.addListenerOnce(map, 'bounds_changed', () => {
        if (map.getZoom() > 15) {
          map.setZoom(15);
        }
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
      html += `<span class="store-type-badge">${escapeHtml(store.type)}</span>`;
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

      button.addEventListener('click', () => {
        currentRadius = radius;

        // Update active state
        container.querySelectorAll('.distance-filter-btn').forEach(btn => {
          btn.classList.remove('active');
        });
        button.classList.add('active');

        // Re-filter and display
        filterAndDisplayStores();
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
      option.textContent = type === 'all' ? 'All Types' : type;
      select.appendChild(option);
    });

    select.addEventListener('change', (e) => {
      currentFilters.type = e.target.value;
      filterAndDisplayStores();
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

    select.addEventListener('change', (e) => {
      currentFilters.product = e.target.value;
      filterAndDisplayStores();
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

      // Trigger map resize and re-center
      if (map) {
        google.maps.event.trigger(map, 'resize');
        if (currentLocation) {
          map.panTo(currentLocation);
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
