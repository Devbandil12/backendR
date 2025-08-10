// src/components/AddressSelection.jsx
import React, { useState } from "react";

const API_BASE = `${import.meta.env.VITE_BACKEND_URL.replace(/\/$/, "")}/api/address`;

export default function AddressSelection({
  // Existing props you already had
  addresses,
  setAddresses,
  setSelectedAddress,
  selectedAddressIndex,
  setSelectedAddressIndex,
  newAddress,
  setNewAddress,
  handlePincodeBlur,
  addressFieldsOrder,
  emptyAddress,
  editingIndex,
  setEditingIndex,

  // NEW props for API integration
  userId, // required for API calls
}) {
  const [showForm, setShowForm] = useState(false);

  // --------------------
  // API CALLS
  // --------------------
  const fetchAddresses = async () => {
    const res = await fetch(`${API_BASE}/list/${userId}`);
    const data = await res.json();
    if (data.success) setAddresses(data.data);
  };

  const saveAddressAPI = async () => {
    const res = await fetch(`${API_BASE}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...newAddress, userId }),
    });
    const data = await res.json();
    if (data.success) {
      await fetchAddresses();
      setShowForm(false);
    }
  };

  const updateAddressAPI = async (id) => {
    const res = await fetch(`${API_BASE}/update/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newAddress),
    });
    const data = await res.json();
    if (data.success) {
      await fetchAddresses();
      setShowForm(false);
    }
  };

  const deleteAddressAPI = async (id) => {
    const res = await fetch(`${API_BASE}/soft-delete/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (data.success) await fetchAddresses();
  };

  const setDefaultAPI = async (id) => {
    const res = await fetch(`${API_BASE}/set-default/${id}`, { method: "PUT" });
    const data = await res.json();
    if (data.success) await fetchAddresses();
  };

  // --------------------
  // LOCATION HANDLER
  // --------------------
  const useMyLocation = () => {
    if (!navigator.geolocation) return alert("Geolocation is not supported");
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude, longitude } = pos.coords;
      const res = await fetch(`${API_BASE}/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, latitude, longitude, name: "My Location", phone: "" }),
      });
      const data = await res.json();
      if (data.success) fetchAddresses();
    });
  };

  // --------------------
  // UI EVENT HANDLERS
  // --------------------
  const onSelectAddress = (addr, idx) => {
    setSelectedAddressIndex(idx);
    setSelectedAddress(addr);
    setEditingIndex(null);
    setNewAddress(emptyAddress);
    setShowForm(false);
  };

  const onAddNewClick = () => {
    setEditingIndex(null);
    setNewAddress(emptyAddress);
    setSelectedAddress(null);
    setSelectedAddressIndex(null);
    setShowForm(true);
  };

  const onEditClick = (idx) => {
    setEditingIndex(idx);
    setNewAddress(addresses[idx]);
    setShowForm(true);
  };

  const onSaveClick = () => {
    if (editingIndex !== null) {
      updateAddressAPI(addresses[editingIndex].id);
    } else {
      saveAddressAPI();
    }
  };

  // --------------------
  // RENDER
  // --------------------
  return (
    <div className="address-selection">
      <h2>Select or Add Delivery Address</h2>

      <div className="address-actions">
        <button className="add-new-btn" onClick={onAddNewClick}>
          + Add New Address
        </button>
        <button className="use-location-btn" onClick={useMyLocation}>
          📍 Use My Location
        </button>
      </div>

      <div className="address-selection__content">
        {/* Address List */}
        <div className="address-selection__list">
          {addresses.map((addr, i) => (
            <div
              key={addr.id}
              className={`address-card ${selectedAddressIndex === i ? "address-card--active" : ""}`}
              onClick={() => onSelectAddress(addr, i)}
            >
              <div className="address-card__header">
                <strong>{addr.name}</strong>
                {addr.isDefault && <span className="default-badge">Default</span>}
                <div className="address-card__actions">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditClick(i);
                    }}
                  >
                    ✎
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteAddressAPI(addr.id);
                    }}
                  >
                    🗑
                  </button>
                </div>
              </div>
              <p>{addr.address}, {addr.city}, {addr.state} – {addr.postalCode}</p>
              <p>{addr.country}</p>
              {addr.phone && <p>📞 {addr.phone}</p>}
              <button
                className="set-default-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setDefaultAPI(addr.id);
                }}
              >
                Set as Default
              </button>
            </div>
          ))}
        </div>

        {/* Address Form */}
        {showForm && (
          <div className="address-selection__form">
            <h3>{editingIndex !== null ? "Edit Address" : "Add New Address"}</h3>
            <div className="address-form__fields">
              {addressFieldsOrder.map((field) => (
                <label key={field}>
                  <span>{field[0].toUpperCase() + field.slice(1)}</span>
                  <input
                    name={field}
                    value={newAddress[field] || ""}
                    onChange={(e) => setNewAddress({ ...newAddress, [field]: e.target.value })}
                    onKeyDown={
                      field === "postalCode"
                        ? (e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handlePincodeBlur();
                            }
                          }
                        : undefined
                    }
                  />
                </label>
              ))}
              <label>
                <span>Default Address</span>
                <input
                  type="checkbox"
                  checked={newAddress.isDefault || false}
                  onChange={(e) =>
                    setNewAddress({ ...newAddress, isDefault: e.target.checked })
                  }
                />
              </label>
            </div>
            <div className="address-form__actions">
              <button onClick={onSaveClick}>
                {editingIndex !== null ? "Update Address" : "Save Address"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
